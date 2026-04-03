from alliance_server.shared import *

from auth import (
    AuthHandler,
    ROLE_SUPERADMIN,
    get_current_auth,
    read_session_token_from_handler,
)

class CoreHandlerMixin:
    def do_GET(self):
        self.run_safely(self._do_GET_impl)

    def do_POST(self):
        self.run_safely(self._do_POST_impl)

    def do_PUT(self):
        self.run_safely(self._do_PUT_impl)

    def do_DELETE(self):
        self.run_safely(self._do_DELETE_impl)

    def _do_GET_impl(self):
        cleanup_sessions()
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/auth/"):
            AuthHandler(self).handle()
            return
        if parsed.path == "/ws/melon":
            self.handle_melon_websocket_upgrade()
            return
        if parsed.path == "/ws/auth":
            self.handle_auth_websocket_upgrade()
            return
        if parsed.path.startswith("/api/db/"):
            self.handle_db_api(parsed)
            return
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed)
            return
        self.serve_static(parsed.path)

    def _do_POST_impl(self):
        cleanup_sessions()
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/auth/"):
            AuthHandler(self).handle()
            return
        if parsed.path.startswith("/api/db/"):
            self.handle_db_api_post(parsed)
            return
        if parsed.path.startswith("/api/"):
            self.handle_api_post(parsed)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def _do_PUT_impl(self):
        cleanup_sessions()
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/db/"):
            self.handle_db_api_put(parsed)
            return
        if parsed.path.startswith("/api/"):
            self.handle_api_put(parsed)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def _do_DELETE_impl(self):
        cleanup_sessions()
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/db/"):
            self.handle_db_api_delete(parsed)
            return
        if parsed.path.startswith("/api/"):
            self.handle_api_delete(parsed)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def run_safely(self, handler):
        try:
            handler()
        except BrokenPipeError:
            raise
        except Exception as exc:
            sys.stderr.write(f"[server-error] {self.command} {self.path}: {exc}\n")
            traceback.print_exc()
            if getattr(self, "wfile", None) and not self.wfile.closed:
                try:
                    self.send_json({"error": f"服务器内部错误: {exc}"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
                except Exception:
                    pass

    def serve_static(self, path: str):
        target = PUBLIC_DIR / path.lstrip("/")
        if path in ("", "/"):
            target = PUBLIC_DIR / "auth.html"

        if target.is_dir():
            target = target / "index.html"

        try:
            resolved = target.resolve()
            if not str(resolved).startswith(str(PUBLIC_DIR.resolve())) or not resolved.exists():
                raise FileNotFoundError
        except FileNotFoundError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_type = "text/plain; charset=utf-8"
        if resolved.suffix == ".html":
            content_type = "text/html; charset=utf-8"
        elif resolved.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        elif resolved.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"
        elif resolved.suffix == ".json":
            content_type = "application/json; charset=utf-8"
        elif resolved.suffix == ".txt":
            content_type = "text/plain; charset=utf-8"
        elif resolved.suffix == ".pdf":
            content_type = "application/pdf"
        elif resolved.suffix == ".docx":
            content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif resolved.suffix == ".pptx":
            content_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        elif resolved.suffix == ".mp3":
            content_type = "audio/mpeg"
        elif resolved.suffix == ".mp4":
            content_type = "video/mp4"
        elif resolved.suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
            content_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"

        file_size = resolved.stat().st_size
        range_header = (self.headers.get("Range") or "").strip()
        start = 0
        end = file_size - 1
        status = HTTPStatus.OK
        if range_header:
            parsed_range = self.parse_http_range(range_header, file_size)
            if parsed_range is None:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
                return
            start, end = parsed_range
            status = HTTPStatus.PARTIAL_CONTENT

        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(max(0, end - start + 1)))
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        if resolved.suffix in {".html", ".css", ".js"}:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        self.end_headers()
        with resolved.open("rb") as handle:
            handle.seek(start)
            remaining = max(0, end - start + 1)
            while remaining > 0:
                chunk = handle.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def parse_http_range(self, range_header, file_size):
        if not range_header.startswith("bytes="):
            return None
        value = range_header[6:].strip()
        if "," in value:
            return None
        start_text, sep, end_text = value.partition("-")
        if not sep:
            return None
        try:
            if start_text == "":
                suffix_length = int(end_text)
                if suffix_length <= 0:
                    return None
                start = max(file_size - suffix_length, 0)
                end = file_size - 1
            else:
                start = int(start_text)
                end = file_size - 1 if end_text == "" else int(end_text)
        except ValueError:
            return None
        if file_size <= 0 or start < 0 or end < start or start >= file_size:
            return None
        return start, min(end, file_size - 1)

    def handle_melon_websocket_upgrade(self):
        upgrade_header = (self.headers.get("Upgrade") or "").lower()
        connection_header = (self.headers.get("Connection") or "").lower()
        key = self.headers.get("Sec-WebSocket-Key")
        version = self.headers.get("Sec-WebSocket-Version")
        if upgrade_header != "websocket" or "upgrade" not in connection_header or not key or version != "13":
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid WebSocket handshake")
            return

        accept_value = base64.b64encode(
            hashlib.sha1((key + WS_MAGIC_GUID).encode("utf-8")).digest()
        ).decode("ascii")
        self.send_response(HTTPStatus.SWITCHING_PROTOCOLS)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept_value)
        self.end_headers()

        client = self.melon_websocket_client_class(self.connection, self.client_address)
        self.register_ws_client(client)
        try:
            client.read_loop()
        finally:
            self.unregister_ws_client(client)

    def handle_auth_websocket_upgrade(self):
        auth = get_current_auth(self)
        session_token = read_session_token_from_handler(self)
        if not auth.get("authenticated") or not session_token:
            self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
            return

        upgrade_header = (self.headers.get("Upgrade") or "").lower()
        connection_header = (self.headers.get("Connection") or "").lower()
        key = self.headers.get("Sec-WebSocket-Key")
        version = self.headers.get("Sec-WebSocket-Version")
        if upgrade_header != "websocket" or "upgrade" not in connection_header or not key or version != "13":
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid WebSocket handshake")
            return

        accept_value = base64.b64encode(
            hashlib.sha1((key + WS_MAGIC_GUID).encode("utf-8")).digest()
        ).decode("ascii")
        self.send_response(HTTPStatus.SWITCHING_PROTOCOLS)
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept_value)
        self.end_headers()

        client = self.auth_websocket_client_class(self.connection, self.client_address, session_token)
        self.register_auth_ws_client(session_token, client)
        try:
            client.read_loop()
        finally:
            self.unregister_auth_ws_client(session_token, client)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json({"error": "JSON 格式不正确"}, status=HTTPStatus.BAD_REQUEST)
            raise

    def require_admin(self):
        current = get_current_auth(self)
        if not current.get("authenticated") or not current.get("is_admin"):
            self.send_json({"error": "请先登录管理员账号"}, status=HTTPStatus.UNAUTHORIZED)
            return None
        return current["user"]

    def has_permission(self, user, permission):
        if not user:
            return False
        if user.get("role") == ROLE_SUPERADMIN or user.get("is_admin"):
            return True
        return permission in set(user.get("permissions") or [])

    def can_access_alliance(self, user, alliance_name, permission):
        if not self.has_permission(user, permission):
            return False
        if user.get("role") == ROLE_SUPERADMIN or user.get("is_admin"):
            return True
        with open_db() as connection:
            return self.scope_matches_user_league(connection, user, alliance_name)

    def require_permission(self, permission, alliance_name=None, allow_admin_account=True):
        current = get_current_auth(self)
        if not current.get("authenticated"):
            self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
            return None
        user = current.get("user") or {}
        if not allow_admin_account and current.get("is_admin"):
            self.send_json({"error": "当前账号不能执行该操作"}, status=HTTPStatus.FORBIDDEN)
            return None
        allowed = self.has_permission(user, permission) if alliance_name is None else self.can_access_alliance(user, alliance_name, permission)
        if not allowed:
            self.send_json({"error": "当前账号没有执行该操作的权限"}, status=HTTPStatus.FORBIDDEN)
            return None
        return user

    def require_normal_user(self):
        current = get_current_auth(self)
        if not current.get("authenticated"):
            self.send_json({"error": "请先登录普通用户账号"}, status=HTTPStatus.UNAUTHORIZED)
            return None
        if current.get("is_admin"):
            self.send_json({"error": "管理员请使用管理员功能页面"}, status=HTTPStatus.FORBIDDEN)
            return None
        return current["user"]

    def get_current_admin(self):
        current = get_current_auth(self)
        if not current.get("authenticated") or not current.get("is_admin"):
            return None
        return current["user"]

    def get_current_user_or_admin(self):
        """Get current user whether admin or normal user."""
        current = get_current_auth(self)
        if not current.get("authenticated"):
            return None
        return current["user"]

    def get_guild_registry_item(self, guild_key):
        with open_db() as connection:
            row = connection.execute("SELECT * FROM guild_registry WHERE guild_key = ?", (guild_key,)).fetchone()
        return dict(row) if row else None

    def get_member_item(self, member_id):
        if not str(member_id).isdigit():
            return None
        with open_db() as connection:
            row = connection.execute("SELECT * FROM members WHERE id = ?", (int(member_id),)).fetchone()
        return dict(row) if row else None

    def read_session_token(self):
        cookie_header = self.headers.get("Cookie")
        if not cookie_header:
            return None
        cookie = SimpleCookie()
        cookie.load(cookie_header)
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel else None

    def delete_member_screenshot_file(self, screenshot_path):
        if not screenshot_path:
            return
        target = PUBLIC_DIR / str(screenshot_path).lstrip("/")
        try:
            resolved = target.resolve()
            uploads_root = UPLOADS_DIR.resolve()
            if str(resolved).startswith(str(uploads_root)) and resolved.exists():
                resolved.unlink()
        except FileNotFoundError:
            return

    def send_excel_file(self, workbook, filename):
        buffer = io.BytesIO()
        workbook.save(buffer)
        data = buffer.getvalue()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def export_guilds_excel(self):
        with open_db() as connection:
            guilds = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT alliance, hill, guild_code, guild_prefix, guild, guild_power, leader_name, updated_at
                    FROM guild_registry
                    ORDER BY CAST(COALESCE(NULLIF(guild_code, ''), '0') AS INTEGER) DESC, guild_prefix ASC, guild ASC
                    """
                ).fetchall()
            ]

        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.title = "guilds"
        sheet.append(["联盟名称", "山头号", "山头名", "妖盟名称", "妖盟总战力", "盟主昵称"])
        for guild in guilds:
            sheet.append([
                "🔮联盟",
                guild.get("guild_code") or "",
                guild.get("guild_prefix") or "",
                guild.get("guild") or "",
                format_number(guild.get("guild_power", 0)),
                guild.get("leader_name") or "",
            ])
        emoji_font = Font(name="Segoe UI Emoji")
        for cell in sheet["A"]:
            cell.font = emoji_font
        self.send_excel_file(workbook, "guilds_export.xlsx")

    def export_guild_members_excel(self, guild_key):
        with open_db() as connection:
            guild = connection.execute(
                """
                SELECT alliance, hill, guild_code, guild_prefix, guild, guild_power, leader_name, updated_at
                FROM guild_registry
                WHERE guild_key = ?
                """,
                (guild_key,),
            ).fetchone()
            if not guild:
                self.send_json({"error": "妖盟不存在"}, status=HTTPStatus.NOT_FOUND)
                return

            members = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT name, role, realm, power, speed, pet, bonus_damage, damage_reduction, note, updated_at
                    FROM members
                    WHERE guild_code = ? AND guild_prefix = ? AND guild = ?
                    ORDER BY power DESC, id DESC
                    """,
                    (guild["guild_code"], guild["guild_prefix"], guild["guild"]),
                ).fetchall()
            ]

        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.title = "members"
        sheet.append([
            "联盟名称",
            "山头号",
            "山名字号",
            "妖盟名称",
            "妖盟总战力",
            "成员昵称",
            "等级",
            "境界",
            "战力",
            "敏捷",
            "灵兽",
            "增伤",
            "减伤",
        ])
        for member in members:
            sheet.append([
                "🔮联盟",
                guild["guild_code"] or "",
                guild["guild_prefix"] or "",
                guild["guild"] or "",
                format_number(guild["guild_power"] or 0),
                member.get("name") or "",
                member.get("role") or "",
                member.get("realm") or "",
                format_number(member.get("power", 0)),
                format_number(member.get("speed", 0)),
                member.get("pet") or "",
                member.get("bonus_damage") if member.get("bonus_damage") not in (None, "") else "",
                member.get("damage_reduction") if member.get("damage_reduction") not in (None, "") else "",
            ])
        emoji_font = Font(name="Segoe UI Emoji")
        for cell in sheet["A"]:
            cell.font = emoji_font
        safe_code = guild["guild_code"] or "guild"
        self.send_excel_file(workbook, f"guild_members_{safe_code}.xlsx")

    def send_json(self, payload, status=HTTPStatus.OK):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        sys.stdout.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))
