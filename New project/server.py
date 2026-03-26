import hashlib
import hmac
import json
import logging
import secrets
import sqlite3
import smtplib
import sys
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

# 导入认证模块
from auth import AuthHandler, initialize_auth_database, user_sessions, USER_SESSION_COOKIE, USER_SESSION_TTL_SECONDS

BASE_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = BASE_DIR / "public"
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "alliance.db"
HOST = "127.0.0.1"
PORT = 8000
SESSION_COOKIE = "user_session"  # 统一使用与 auth.py 相同的 cookie 名称
SESSION_TTL_SECONDS = 60 * 60 * 12

# 管理员会话
sessions = {}

# 邮件配置 - 请根据实际情况修改
SMTP_CONFIG = {
    "host": "smtp.qq.com",
    "port": 587,
    "use_tls": True,
    "username": "2629430873@qq.com",  
    "password": "obvszlnbldobeacd",  
    "from_name": "寻道大千联盟",
}


def now_text():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def hash_password(password: str, salt: str) -> str:
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return hashed.hex()


def open_db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open_db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                display_name TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS announcements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                category TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alliance TEXT NOT NULL,
                hill TEXT NOT NULL DEFAULT '默认山头',
                guild_code TEXT NOT NULL DEFAULT '',
                guild_prefix TEXT NOT NULL DEFAULT '',
                guild_power INTEGER NOT NULL DEFAULT 0,
                guild TEXT NOT NULL,
                name TEXT NOT NULL,
                role TEXT NOT NULL,
                realm TEXT NOT NULL,
                power INTEGER NOT NULL DEFAULT 0,
                hp INTEGER NOT NULL DEFAULT 0,
                attack INTEGER NOT NULL DEFAULT 0,
                defense INTEGER NOT NULL DEFAULT 0,
                speed INTEGER NOT NULL DEFAULT 0,
                bonus_damage INTEGER NOT NULL DEFAULT 0,
                damage_reduction INTEGER NOT NULL DEFAULT 0,
                pet TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )

        admin_count = connection.execute("SELECT COUNT(*) AS count FROM admins").fetchone()["count"]
        if admin_count == 0:
            salt = secrets.token_hex(16)
            connection.execute(
                """
                INSERT INTO admins (username, password_hash, salt, display_name, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                ("admin", hash_password("123456", salt), salt, "联盟管理员", now_text()),
            )

        columns = [row["name"] for row in connection.execute("PRAGMA table_info(members)").fetchall()]
        if "hill" not in columns:
            connection.execute("ALTER TABLE members ADD COLUMN hill TEXT NOT NULL DEFAULT '默认山头'")
        if "guild_code" not in columns:
            connection.execute("ALTER TABLE members ADD COLUMN guild_code TEXT NOT NULL DEFAULT ''")
        if "guild_prefix" not in columns:
            connection.execute("ALTER TABLE members ADD COLUMN guild_prefix TEXT NOT NULL DEFAULT ''")
        if "guild_power" not in columns:
            connection.execute("ALTER TABLE members ADD COLUMN guild_power INTEGER NOT NULL DEFAULT 0")
        if "bonus_damage" not in columns:
            connection.execute("ALTER TABLE members ADD COLUMN bonus_damage INTEGER NOT NULL DEFAULT 0")
        if "damage_reduction" not in columns:
            connection.execute("ALTER TABLE members ADD COLUMN damage_reduction INTEGER NOT NULL DEFAULT 0")

        announcement_count = connection.execute("SELECT COUNT(*) AS count FROM announcements").fetchone()["count"]
        if announcement_count == 0:
            seed_announcements = [
                ("联盟招新开启", "本周开放 2 个妖盟名额，要求活跃、配合填表。", "公告"),
                ("周日晚联盟战", "请各妖盟于 20:00 前同步主力战力和灵兽配置。", "公告"),
                ("天狐妖盟昨晚冲榜成功", "前三主力全部破 30 万战，今天已经坐稳联盟第一梯队。", "瓜棚"),
                ("玄龟妖盟准备换阵", "据说正在测试双反击流，有望下周冲进前二。", "瓜棚"),
            ]
            connection.executemany(
                "INSERT INTO announcements (title, content, category, created_at) VALUES (?, ?, ?, ?)",
                [(title, content, category, now_text()) for title, content, category in seed_announcements],
            )

        member_count = connection.execute("SELECT COUNT(*) AS count FROM members").fetchone()["count"]
        if member_count == 0:
            timestamp = now_text()
            seed_members = [
                ("青云联盟", "蓬莱1-方丈12", "833", "长虹山", 865200, "天狐妖盟", "青玄子", "盟主", "化神后期", 328000, 98000, 23500, 16800, 9200, "应龙", "主修暴击流，负责联盟指挥。", timestamp, timestamp),
                ("青云联盟", "方丈13-瀛洲4", "612", "望月山", 612800, "玄龟妖盟", "白芷", "副盟主", "元婴圆满", 285600, 86200, 21000, 15200, 10100, "九尾狐", "负责资源统计与招新审核。", timestamp, timestamp),
                ("青云联盟", "蓬莱1-方丈12", "501", "赤羽山", 501300, "赤羽妖盟", "曜尘", "长老", "元婴后期", 243500, 79800, 18700, 14500, 8800, "玄龟", "主抗伤阵容，联盟战前排。", timestamp, timestamp),
            ]
            connection.executemany(
                """
                INSERT INTO members (
                    alliance, hill, guild_code, guild_prefix, guild_power, guild, name, role, realm, power, hp, attack, defense, speed, pet, note, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                seed_members,
            )

        connection.commit()


def cleanup_sessions():
    current = datetime.now().timestamp()
    expired = [token for token, value in sessions.items() if current - value["created_at"] > SESSION_TTL_SECONDS]
    for token in expired:
        sessions.pop(token, None)


class AllianceHandler(BaseHTTPRequestHandler):
    server_version = "AlliancePortal/1.0"

    def do_GET(self):
        cleanup_sessions()
        parsed = urlparse(self.path)
        
        # 处理认证 API
        if parsed.path.startswith("/api/auth/"):
            self.handle_auth_get(parsed)
            return
        
        if parsed.path.startswith("/api/"):
            self.handle_api_get(parsed)
            return
        self.serve_static(parsed.path)

    def do_POST(self):
        cleanup_sessions()
        parsed = urlparse(self.path)
        
        # 处理认证 API
        if parsed.path.startswith("/api/auth/"):
            self.handle_auth_post(parsed)
            return
        
        if parsed.path.startswith("/api/"):
            self.handle_api_post(parsed)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_PUT(self):
        cleanup_sessions()
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_put(parsed)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def do_DELETE(self):
        cleanup_sessions()
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self.handle_api_delete(parsed)
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def serve_static(self, path: str):
        target = PUBLIC_DIR / path.lstrip("/")
        if path in ("", "/"):
            target = PUBLIC_DIR / "index.html"

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

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        self.wfile.write(resolved.read_bytes())

    def handle_api_get(self, parsed):
        if parsed.path == "/api/health":
            self.send_json({"status": "ok", "time": now_text()})
            return
        if parsed.path == "/api/me":
            # 优先从 server.py 的 sessions 获取管理员信息
            admin = self.get_current_admin()
            if admin:
                self.send_json({"authenticated": True, "admin": admin})
                return
            
            # 如果 server.py 没有会话，尝试从 auth.py 的 user_sessions 获取
            from auth import user_sessions
            token = self.read_session_token()
            if token and token in user_sessions:
                session = user_sessions[token]
                if session.get("is_admin"):
                    self.send_json({
                        "authenticated": True, 
                        "admin": {
                            "username": session["username"],
                            "display_name": session.get("display_name", session["username"])
                        }
                    })
                    return
            
            self.send_json({"authenticated": False, "admin": None})
            return
        if parsed.path == "/api/dashboard":
            self.send_json(self.build_dashboard())
            return
        if parsed.path == "/api/members":
            query = parse_qs(parsed.query)
            self.send_json(self.list_members(query))
            return
        if parsed.path == "/api/announcements":
            self.send_json(self.list_announcements())
            return
        self.send_json({"error": "接口不存在"}, status=HTTPStatus.NOT_FOUND)

    def handle_api_post(self, parsed):
        if parsed.path == "/api/login":
            payload = self.read_json()
            self.login(payload)
            return
        if parsed.path == "/api/logout":
            self.logout()
            return
        if parsed.path == "/api/members":
            admin = self.require_admin()
            if not admin:
                return
            payload = self.read_json()
            self.create_member(payload)
            return
        if parsed.path == "/api/announcements":
            admin = self.require_admin()
            if not admin:
                return
            payload = self.read_json()
            self.create_announcement(payload)
            return
        self.send_json({"error": "接口不存在"}, status=HTTPStatus.NOT_FOUND)

    def handle_api_put(self, parsed):
        if parsed.path.startswith("/api/members/"):
            admin = self.require_admin()
            if not admin:
                return
            payload = self.read_json()
            member_id = parsed.path.rsplit("/", 1)[-1]
            self.update_member(member_id, payload)
            return
        if parsed.path.startswith("/api/announcements/"):
            admin = self.require_admin()
            if not admin:
                return
            payload = self.read_json()
            announcement_id = parsed.path.rsplit("/", 1)[-1]
            self.update_announcement(announcement_id, payload)
            return
        self.send_json({"error": "接口不存在"}, status=HTTPStatus.NOT_FOUND)

    def handle_api_delete(self, parsed):
        if parsed.path.startswith("/api/members/"):
            admin = self.require_admin()
            if not admin:
                return
            member_id = parsed.path.rsplit("/", 1)[-1]
            self.delete_by_id("members", member_id)
            return
        if parsed.path.startswith("/api/announcements/"):
            admin = self.require_admin()
            if not admin:
                return
            announcement_id = parsed.path.rsplit("/", 1)[-1]
            self.delete_by_id("announcements", announcement_id)
            return
        self.send_json({"error": "接口不存在"}, status=HTTPStatus.NOT_FOUND)

    def build_dashboard(self):
        with open_db() as connection:
            members = [dict(row) for row in connection.execute("SELECT * FROM members").fetchall()]
            announcements = [dict(row) for row in connection.execute("SELECT * FROM announcements ORDER BY id DESC").fetchall()]

        total_power = sum(member["power"] for member in members)
        hill_map = {}
        for member in members:
            hill_name = member["hill"] or "默认山头"
            guild_name = member["guild"]
            guild_code = member.get("guild_code", "")
            guild_prefix = member.get("guild_prefix", "")
            guild_key = build_guild_key(guild_code, guild_prefix, guild_name)
            hill_entry = hill_map.setdefault(hill_name, {"count": 0, "power": 0, "guilds": {}})
            hill_entry["count"] += 1
            hill_entry["power"] += member["power"]
            guild_entry = hill_entry["guilds"].setdefault(guild_key, {
                "name": guild_name,
                "code": guild_code,
                "prefix": guild_prefix,
                "display_name": build_guild_display_name(guild_code, guild_prefix, guild_name),
                "count": 0,
                "power": 0,
                "custom_power": 0,
                "top_member": member,
            })
            guild_entry["count"] += 1
            guild_entry["power"] += member["power"]
            guild_entry["custom_power"] = max(guild_entry["custom_power"], int(member.get("guild_power", 0) or 0))
            if member["power"] > guild_entry["top_member"]["power"]:
                guild_entry["top_member"] = member

        hills = []
        flat_guilds = []
        for hill_name, hill_info in sorted(hill_map.items(), key=lambda item: item[1]["power"], reverse=True):
            guilds = []
            for _, guild_info in sorted(hill_info["guilds"].items(), key=lambda item: item[1]["power"], reverse=True):
                guild_payload = {
                    "name": guild_info["name"],
                    "code": guild_info["code"],
                    "prefix": guild_info["prefix"],
                    "display_name": guild_info["display_name"],
                    "hill": hill_name,
                    "count": guild_info["count"],
                    "power": guild_info["custom_power"] or guild_info["power"],
                    "custom_power": guild_info["custom_power"],
                    "top_member": serialize_member(guild_info["top_member"]),
                }
                guilds.append(guild_payload)
                flat_guilds.append(guild_payload)
            hills.append({"name": hill_name, "count": hill_info["count"], "power": hill_info["power"], "guilds": guilds})

        ranking = [serialize_member(member) for member in sorted(members, key=lambda item: item["power"], reverse=True)[:10]]
        public_announcements = [
            {"id": row["id"], "title": row["title"], "content": row["content"], "category": row["category"], "created_at": row["created_at"]}
            for row in announcements
        ]

        return {
            "alliance_name": members[0]["alliance"] if len({member['alliance'] for member in members}) == 1 else "联盟总览",
            "member_count": len(members),
            "total_power": total_power,
            "guild_count": len(flat_guilds),
            "hill_count": len(hills),
            "top_member": ranking[0] if ranking else None,
            "top_guild": flat_guilds[0] if flat_guilds else None,
            "hills": hills,
            "guilds": flat_guilds,
            "ranking": ranking,
            "announcements": [item for item in public_announcements if item["category"] == "公告"],
            "melon_posts": [item for item in public_announcements if item["category"] == "瓜棚"],
        }

    def list_members(self, query):
        search = (query.get("search", [""])[0]).strip().lower()
        hill = (query.get("hill", ["all"])[0]).strip()
        guild = (query.get("guild", ["all"])[0]).strip()
        sort = (query.get("sort", ["power-desc"])[0]).strip()
        order_sql = {
            "power-desc": "power DESC, id DESC",
            "power-asc": "power ASC, id ASC",
            "name-asc": "name COLLATE NOCASE ASC, id DESC",
        }.get(sort, "power DESC, id DESC")

        clauses = []
        values = []
        if hill and hill != "all":
            clauses.append("hill = ?")
            values.append(hill)
        if guild and guild != "all":
            clauses.append("guild = ?")
            values.append(guild)
        if search:
            clauses.append("(LOWER(alliance) LIKE ? OR LOWER(hill) LIKE ? OR LOWER(guild) LIKE ? OR LOWER(name) LIKE ? OR LOWER(role) LIKE ? OR LOWER(realm) LIKE ? OR LOWER(pet) LIKE ? OR LOWER(note) LIKE ?)")
            keyword = f"%{search}%"
            values.extend([keyword] * 8)

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"SELECT * FROM members {where_sql} ORDER BY {order_sql}"
        with open_db() as connection:
            rows = connection.execute(sql, values).fetchall()
        return {"items": [serialize_member(dict(row)) for row in rows]}

    def list_announcements(self):
        with open_db() as connection:
            rows = connection.execute("SELECT * FROM announcements ORDER BY id DESC").fetchall()
        return {
            "items": [
                {
                    "id": row["id"],
                    "title": row["title"],
                    "content": row["content"],
                    "category": row["category"],
                    "created_at": row["created_at"],
                }
                for row in rows
            ]
        }

    def login(self, payload):
        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", "")).strip()
        with open_db() as connection:
            row = connection.execute("SELECT * FROM admins WHERE username = ?", (username,)).fetchone()

        if not row:
            self.send_json({"error": "账号或密码错误"}, status=HTTPStatus.UNAUTHORIZED)
            return

        calculated = hash_password(password, row["salt"])
        if not hmac.compare_digest(calculated, row["password_hash"]):
            self.send_json({"error": "账号或密码错误"}, status=HTTPStatus.UNAUTHORIZED)
            return

        token = secrets.token_hex(24)
        sessions[token] = {"admin_id": row["id"], "username": row["username"], "display_name": row["display_name"], "created_at": datetime.now().timestamp()}

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Set-Cookie", f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; SameSite=Lax")
        self.end_headers()
        self.wfile.write(json.dumps({"message": "登录成功", "admin": {"username": row["username"], "display_name": row["display_name"]}}, ensure_ascii=False).encode("utf-8"))

    def logout(self):
        """用户登出 - 同时清理 auth.py 的 sessions"""
        token = self.read_session_token()
        
        # 清理 server.py 的 sessions
        if token:
            sessions.pop(token, None)
        
        # 同时清理 auth.py 的 user_sessions
        try:
            from auth import user_sessions
            if token and token in user_sessions:
                user_sessions.pop(token, None)
        except Exception:
            pass

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Set-Cookie", f"{SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax")
        self.end_headers()
        self.wfile.write(json.dumps({"message": "已退出登录"}, ensure_ascii=False).encode("utf-8"))

    def create_member(self, payload):
        try:
            member = validate_member(payload)
        except ValueError as error:
            self.send_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
            return
        timestamp = now_text()
        with open_db() as connection:
            cursor = connection.execute(
                """
                INSERT INTO members (
                    alliance, hill, guild_code, guild_prefix, guild_power, guild, name, role, realm, power, hp, attack, defense, speed, bonus_damage, damage_reduction, pet, note, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    member["alliance"], member["hill"], member["guild_code"], member["guild_prefix"], member["guild_power"], member["guild"], member["name"], member["role"], member["realm"], member["power"],
                    member["hp"], member["attack"], member["defense"], member["speed"], member["bonus_damage"], member["damage_reduction"], member["pet"], member["note"],
                    timestamp, timestamp,
                ),
            )
            connection.commit()

        member["id"] = cursor.lastrowid
        member["created_at"] = timestamp
        member["updated_at"] = timestamp
        self.send_json({"message": "成员创建成功", "item": member}, status=HTTPStatus.CREATED)

    def update_member(self, member_id, payload):
        try:
            member = validate_member(payload)
        except ValueError as error:
            self.send_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
            return
        timestamp = now_text()
        with open_db() as connection:
            cursor = connection.execute(
                """
                UPDATE members
                SET alliance = ?, hill = ?, guild_code = ?, guild_prefix = ?, guild_power = ?, guild = ?, name = ?, role = ?, realm = ?, power = ?, hp = ?, attack = ?, defense = ?, speed = ?, bonus_damage = ?, damage_reduction = ?, pet = ?, note = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    member["alliance"], member["hill"], member["guild_code"], member["guild_prefix"], member["guild_power"], member["guild"], member["name"], member["role"], member["realm"], member["power"],
                    member["hp"], member["attack"], member["defense"], member["speed"], member["bonus_damage"], member["damage_reduction"], member["pet"], member["note"],
                    timestamp, member_id,
                ),
            )
            connection.commit()

        if cursor.rowcount == 0:
            self.send_json({"error": "成员不存在"}, status=HTTPStatus.NOT_FOUND)
            return

        member["id"] = int(member_id)
        member["updated_at"] = timestamp
        self.send_json({"message": "成员更新成功", "item": member})

    def create_announcement(self, payload):
        title = str(payload.get("title", "")).strip()
        content = str(payload.get("content", "")).strip()
        category = str(payload.get("category", "公告")).strip() or "公告"
        if not title or not content:
            self.send_json({"error": "标题和内容不能为空"}, status=HTTPStatus.BAD_REQUEST)
            return
        if category not in {"公告", "瓜棚"}:
            self.send_json({"error": "分类不正确"}, status=HTTPStatus.BAD_REQUEST)
            return

        timestamp = now_text()
        with open_db() as connection:
            cursor = connection.execute(
                "INSERT INTO announcements (title, content, category, created_at) VALUES (?, ?, ?, ?)",
                (title, content, category, timestamp),
            )
            connection.commit()

        self.send_json(
            {"message": "内容发布成功", "item": {"id": cursor.lastrowid, "title": title, "content": content, "category": category, "created_at": timestamp}},
            status=HTTPStatus.CREATED,
        )

    def update_announcement(self, announcement_id, payload):
        title = str(payload.get("title", "")).strip()
        content = str(payload.get("content", "")).strip()
        category = str(payload.get("category", "公告")).strip() or "公告"
        if not title or not content:
            self.send_json({"error": "标题和内容不能为空"}, status=HTTPStatus.BAD_REQUEST)
            return

        with open_db() as connection:
            cursor = connection.execute(
                "UPDATE announcements SET title = ?, content = ?, category = ? WHERE id = ?",
                (title, content, category, announcement_id),
            )
            connection.commit()

        if cursor.rowcount == 0:
            self.send_json({"error": "内容不存在"}, status=HTTPStatus.NOT_FOUND)
            return

        self.send_json({"message": "内容更新成功"})

    def delete_by_id(self, table_name, record_id):
        if not record_id.isdigit():
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        with open_db() as connection:
            cursor = connection.execute(f"DELETE FROM {table_name} WHERE id = ?", (record_id,))
            connection.commit()
        if cursor.rowcount == 0:
            self.send_json({"error": "数据不存在"}, status=HTTPStatus.NOT_FOUND)
            return
        self.send_json({"message": "删除成功"})

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json({"error": "JSON 格式不正确"}, status=HTTPStatus.BAD_REQUEST)
            raise

    def require_admin(self):
        admin = self.get_current_admin()
        if not admin:
            self.send_json({"error": "请先登录管理员账号"}, status=HTTPStatus.UNAUTHORIZED)
            return None
        return admin

    def get_current_admin(self):
        token = self.read_session_token()
        if not token:
            return None
        session = sessions.get(token)
        if not session:
            return None
        return {"username": session["username"], "display_name": session["display_name"]}

    def read_session_token(self):
        cookie_header = self.headers.get("Cookie")
        if not cookie_header:
            return None
        cookie = SimpleCookie()
        cookie.load(cookie_header)
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel else None

    def send_json(self, payload, status=HTTPStatus.OK):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ============ 认证 API 处理方法 ============
    
    def handle_auth_get(self, parsed):
        """处理认证 GET 请求"""
        # 初始化认证数据库
        try:
            initialize_auth_database()
        except Exception:
            pass
        
        auth_handler = AuthHandler(self)
        return auth_handler.handle_get(parsed)

    def handle_auth_post(self, parsed):
        """处理认证 POST 请求"""
        # 初始化认证数据库
        try:
            initialize_auth_database()
        except Exception:
            pass
        
        auth_handler = AuthHandler(self)
        return auth_handler.handle_post(parsed)
    
    def log_message(self, fmt, *args):
        sys.stdout.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))


def validate_member(payload):
    member = {
        "alliance": str(payload.get("alliance", "")).strip() or "青云联盟",
        "hill": str(payload.get("hill", "")).strip() or "默认山头",
        "guild_code": str(payload.get("guild_code", "")).strip(),
        "guild_prefix": str(payload.get("guild_prefix", "")).strip(),
        "guild_power": int(payload.get("guild_power", 0) or 0),
        "guild": str(payload.get("guild", "")).strip(),
        "name": str(payload.get("name", "")).strip(),
        "role": str(payload.get("role", "")).strip() or "成员",
        "realm": str(payload.get("realm", "")).strip() or "待补充",
        "power": int(payload.get("power", 0) or 0),
        "hp": int(payload.get("hp", 0) or 0),
        "attack": int(payload.get("attack", 0) or 0),
        "defense": int(payload.get("defense", 0) or 0),
        "speed": int(payload.get("speed", 0) or 0),
        "bonus_damage": int(payload.get("bonus_damage", 0) or 0),
        "damage_reduction": int(payload.get("damage_reduction", 0) or 0),
        "pet": str(payload.get("pet", "")).strip() or "待补充",
        "note": str(payload.get("note", "")).strip(),
    }
    if not member["guild"] or not member["name"]:
        raise ValueError("妖盟和成员昵称不能为空")
    return member


def serialize_member(member):
    return {
        "id": member["id"],
        "alliance": member["alliance"],
        "hill": member.get("hill", "默认山头"),
        "guild_code": member.get("guild_code", ""),
        "guild_prefix": member.get("guild_prefix", ""),
        "guild_power": member.get("guild_power", 0),
        "guild": member["guild"],
        "guild_display": build_guild_display_name(member.get("guild_code", ""), member.get("guild_prefix", ""), member["guild"]),
        "name": member["name"],
        "role": member["role"],
        "realm": member["realm"],
        "power": member["power"],
        "hp": member["hp"],
        "attack": member["attack"],
        "defense": member["defense"],
        "speed": member["speed"],
        "bonus_damage": member.get("bonus_damage", 0),
        "damage_reduction": member.get("damage_reduction", 0),
        "pet": member["pet"],
        "note": member["note"],
        "created_at": member.get("created_at"),
        "updated_at": member.get("updated_at"),
    }


def build_guild_display_name(guild_code, guild_prefix, guild_name):
    parts = [str(guild_code or "").strip(), str(guild_prefix or "").strip(), str(guild_name or "").strip()]
    return " ".join(part for part in parts if part)


def build_guild_key(guild_code, guild_prefix, guild_name):
    return "|".join([
        str(guild_code or "").strip(),
        str(guild_prefix or "").strip(),
        str(guild_name or "").strip(),
    ])


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    initialize_database()
    server = ThreadingHTTPServer((HOST, PORT), AllianceHandler)
    print(f"寻道大千联盟信息站已启动: http://{HOST}:{PORT}")
    print("默认管理员账号: admin")
    print("默认管理员密码: 123456")
    server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n服务器已停止")
