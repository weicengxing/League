import base64
import hashlib
import json
import struct
import threading

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from auth import initialize_auth_database, register_session_invalidation_notifier
from alliance_server.mixins.api_routes import ApiRoutesMixin
from alliance_server.mixins.core import CoreHandlerMixin
from alliance_server.mixins.db_admin import DatabaseAdminMixin
from alliance_server.mixins.member_guild import MemberGuildMixin
from alliance_server.mixins.profile_export import ProfileExportMixin
from alliance_server.mixins.review_requests import ReviewRequestsMixin
from alliance_server.shared import (
    HOST,
    PORT,
    WS_MAGIC_GUID,
    auth_ws_clients,
    auth_ws_clients_lock,
    db_executor,
    initialize_database,
    now_text,
    open_db,
    ws_clients,
    ws_clients_lock,
)


class AllianceHandler(
    ApiRoutesMixin,
    DatabaseAdminMixin,
    MemberGuildMixin,
    ReviewRequestsMixin,
    ProfileExportMixin,
    CoreHandlerMixin,
    BaseHTTPRequestHandler,
):
    server_version = "AlliancePortal/1.0"


def register_ws_client(client):
    with ws_clients_lock:
        ws_clients.add(client)


def unregister_ws_client(client):
    with ws_clients_lock:
        ws_clients.discard(client)


def snapshot_ws_clients():
    with ws_clients_lock:
        return list(ws_clients)


def register_auth_ws_client(session_token, client):
    with auth_ws_clients_lock:
        auth_ws_clients.setdefault(session_token, set()).add(client)


def unregister_auth_ws_client(session_token, client):
    with auth_ws_clients_lock:
        clients = auth_ws_clients.get(session_token)
        if not clients:
            return
        clients.discard(client)
        if not clients:
            auth_ws_clients.pop(session_token, None)


def snapshot_auth_ws_clients(session_token):
    with auth_ws_clients_lock:
        return list(auth_ws_clients.get(session_token, set()))


def notify_invalidated_session(session_token, session):
    dead_clients = []
    message = json.dumps({"type": "session_kicked"}, ensure_ascii=False)
    for client in snapshot_auth_ws_clients(session_token):
        try:
            client.send_text(message)
            client.close()
        except Exception:
            dead_clients.append(client)
    for client in dead_clients:
        unregister_auth_ws_client(session_token, client)


def broadcast_melon_post(melon_item):
    _broadcast_ws_text({
        "type": "melon_new",
        "id": melon_item.get("id"),
        "title": melon_item.get("title", ""),
    })


def broadcast_melon_deleted(deleted_id):
    _broadcast_ws_text({"type": "melon_deleted", "deleted_id": deleted_id})


def _broadcast_ws_text(payload):
    message = json.dumps(payload, ensure_ascii=False)
    dead_clients = []
    for client in snapshot_ws_clients():
        try:
            client.send_text(message)
        except Exception:
            dead_clients.append(client)
    for client in dead_clients:
        unregister_ws_client(client)


class MelonWebSocketClient:
    def __init__(self, connection, client_address):
        self.connection = connection
        self.client_address = client_address
        self.closed = False
        self.send_lock = threading.Lock()

    def _recv_exact(self, size):
        buffer = bytearray()
        while len(buffer) < size:
            chunk = self.connection.recv(size - len(buffer))
            if not chunk:
                raise ConnectionError("WebSocket connection closed")
            buffer.extend(chunk)
        return bytes(buffer)

    def _build_frame(self, payload_bytes, opcode=0x1):
        first_byte = 0x80 | (opcode & 0x0F)
        length = len(payload_bytes)
        if length < 126:
            header = struct.pack("!BB", first_byte, length)
        elif length < 65536:
            header = struct.pack("!BBH", first_byte, 126, length)
        else:
            header = struct.pack("!BBQ", first_byte, 127, length)
        return header + payload_bytes

    def send_text(self, text):
        if self.closed:
            return
        frame = self._build_frame(text.encode("utf-8"), opcode=0x1)
        with self.send_lock:
            self.connection.sendall(frame)

    def send_pong(self, payload=b""):
        if self.closed:
            return
        frame = self._build_frame(payload, opcode=0xA)
        with self.send_lock:
            self.connection.sendall(frame)

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            with self.send_lock:
                self.connection.sendall(self._build_frame(b"", opcode=0x8))
        except Exception:
            pass
        try:
            self.connection.close()
        except Exception:
            pass

    def read_loop(self):
        try:
            while not self.closed:
                header = self._recv_exact(2)
                first_byte, second_byte = header[0], header[1]
                opcode = first_byte & 0x0F
                masked = bool(second_byte & 0x80)
                payload_length = second_byte & 0x7F

                if payload_length == 126:
                    payload_length = struct.unpack("!H", self._recv_exact(2))[0]
                elif payload_length == 127:
                    payload_length = struct.unpack("!Q", self._recv_exact(8))[0]

                mask_key = self._recv_exact(4) if masked else b""
                payload = self._recv_exact(payload_length) if payload_length else b""
                if masked and payload:
                    payload = bytes(byte ^ mask_key[i % 4] for i, byte in enumerate(payload))

                if opcode == 0x8:
                    break
                if opcode == 0x9:
                    self.send_pong(payload)
        except Exception:
            pass
        finally:
            self.close()


class AuthWebSocketClient(MelonWebSocketClient):
    def __init__(self, connection, client_address, session_token):
        super().__init__(connection, client_address)
        self.session_token = session_token


AllianceHandler.melon_websocket_client_class = MelonWebSocketClient
AllianceHandler.auth_websocket_client_class = AuthWebSocketClient
AllianceHandler.register_ws_client = staticmethod(register_ws_client)
AllianceHandler.unregister_ws_client = staticmethod(unregister_ws_client)
AllianceHandler.register_auth_ws_client = staticmethod(register_auth_ws_client)
AllianceHandler.unregister_auth_ws_client = staticmethod(unregister_auth_ws_client)


register_session_invalidation_notifier(notify_invalidated_session)


def async_save_melon_to_db(title, content, author_name):
    def _save():
        timestamp = now_text()
        with open_db() as connection:
            cursor = connection.execute(
                "INSERT INTO announcements (title, content, category, created_at, author) VALUES (?, ?, ?, ?, ?)",
                (title, content, "瓜棚", timestamp, author_name),
            )
            connection.commit()
            return {
                "id": cursor.lastrowid,
                "title": title,
                "content": content,
                "category": "???",
                "created_at": timestamp,
                "author": author_name,
            }

    future = db_executor.submit(_save)
    return future


def create_melon_post(title, content, author_name, user_id=None):
    timestamp = now_text()
    with open_db() as connection:
        cursor = connection.execute(
            "INSERT INTO announcements (title, content, category, created_at, author) VALUES (?, ?, ?, ?, ?)",
            (title, content, "瓜棚", timestamp, author_name),
        )
        connection.commit()
        melon_item = {
            "id": cursor.lastrowid,
            "title": title,
            "content": content,
            "category": "???",
            "created_at": timestamp,
            "author": author_name,
            "author_id": user_id,
        }
    return melon_item


def main():
    initialize_database()
    initialize_auth_database()
    server = ThreadingHTTPServer((HOST, PORT), AllianceHandler)
    print(f"??????????????????: http://{HOST}:{PORT}")
    print("??????????? admin")
    print("??????????? 123456")
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n?????????")
