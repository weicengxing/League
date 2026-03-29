import hashlib
import base64
import html
import hmac
import io
import json
import mimetypes
import secrets
import sqlite3
import traceback
import sys
import struct
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from html.parser import HTMLParser
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import openpyxl
from openpyxl.styles import Font

from auth import LEAGUE_SCOPE_SEPARATOR


class MultiPartFormDataParser:
    """简单的 multipart/form-data 解析器，兼容 Python 3.11+"""
    
    def __init__(self, content_type, body):
        self.content_type = content_type
        self.body = body
        self.form = {}
        self._parse()
    
    def _parse(self):
        # 提取 boundary
        boundary = None
        for part in self.content_type.split(';'):
            part = part.strip()
            if part.startswith('boundary='):
                boundary = part[9:].strip('"\'')
                break
        
        if not boundary:
            return
        
        # 添加 -- 前缀
        boundary = '--' + boundary
        
        # 分割各部分
        parts = self.body.split(boundary)
        
        for part in parts:
            part = part.strip('\r\n')
            if not part or part == '--':
                continue
            
            # 分离 headers 和 content
            if '\r\n\r\n' in part:
                headers_section, content = part.split('\r\n\r\n', 1)
            elif '\n\n' in part:
                headers_section, content = part.split('\n\n', 1)
            else:
                continue
            
            # 解析 headers
            headers = {}
            for line in headers_section.split('\r\n'):
                if ':' in line:
                    key, value = line.split(':', 1)
                    headers[key.strip().lower()] = value.strip()
            
            # 获取 filename 和 field name
            disp = headers.get('content-disposition', '')
            filename = None
            field_name = None
            
            for item in disp.split(';'):
                item = item.strip()
                if item.startswith('name='):
                    field_name = item[5:].strip('"\'')
                elif item.startswith('filename='):
                    filename = item[10:].strip('"\'')
            
            if not field_name:
                continue
            
            # 移除末尾的 \r\n
            if content.endswith('\r\n'):
                content = content[:-2]
            
            if filename:
                self.form[field_name] = type('FileField', (), {
                    'filename': filename,
                    'file': type('BytesIO', (), {'read': lambda self: content}),
                    'value': content
                })()
            else:
                try:
                    self.form[field_name] = content.decode('utf-8', errors='replace')
                except:
                    self.form[field_name] = str(content)


def parse_form_data(handler):
    """解析 multipart/form-data 请求"""
    content_type = handler.headers.get('Content-Type', '')
    content_length = int(handler.headers.get('Content-Length', 0))
    body = handler.rfile.read(content_length)
    
    if 'multipart/form-data' in content_type:
        return MultiPartFormDataParser(content_type, body)
    
    # 对于普通 form data
    import urllib.parse
    try:
        data = body.decode('utf-8')
        return urllib.parse.parse_qs(data)
    except:
        return {}
from html.parser import HTMLParser
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import openpyxl
from openpyxl.styles import Font

from auth import (
    AuthHandler,
    LEAGUE_SCOPE_SEPARATOR,
    ROLE_ALLIANCEADMIN,
    ROLE_GUEST,
    ROLE_SUPERADMIN,
    ROLE_VERIFIEDUSER,
    get_current_auth,
    initialize_auth_database,
    read_session_token_from_handler,
    register_session_invalidation_notifier,
    update_user_sessions_for_user,
)


BASE_DIR = Path(__file__).resolve().parent.parent
PUBLIC_DIR = BASE_DIR / "public"
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = PUBLIC_DIR / "uploads" / "member-screenshots"
DB_PATH = DATA_DIR / "alliance.db"
HOST = "127.0.0.1"
PORT = 8000
SESSION_COOKIE = "alliance_session"
SESSION_TTL_SECONDS = 60 * 60 * 12

sessions = {}

# WebSocket clients connected for real-time melon updates
ws_clients = set()
ws_clients_lock = threading.Lock()
auth_ws_clients = {}
auth_ws_clients_lock = threading.Lock()
WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# Thread pool for async database writes
db_executor = ThreadPoolExecutor(max_workers=2)
ROLE_REQUEST_TYPE_GUILD = "guild"
ROLE_REQUEST_TYPE_ALLIANCE = "alliance"


def now_text():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def split_league_scopes(value):
    return [
        item.strip()
        for item in str(value or "").split(LEAGUE_SCOPE_SEPARATOR)
        if item and item.strip()
    ]


def join_league_scopes(values):
    return LEAGUE_SCOPE_SEPARATOR.join(dict.fromkeys(split_league_scopes(LEAGUE_SCOPE_SEPARATOR.join(values or []))))


class RichTextSanitizer(HTMLParser):
    allowed_tags = {"b", "strong", "i", "em", "u", "br", "p", "ul", "ol", "li", "a"}

    def __init__(self):
        super().__init__()
        self.parts = []

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag not in self.allowed_tags:
            return
        if tag == "a":
            href = ""
            for key, value in attrs:
                if key.lower() == "href" and isinstance(value, str) and value.startswith(("http://", "https://")):
                    href = html.escape(value, quote=True)
                    break
            if href:
                self.parts.append(f'<a href="{href}" target="_blank" rel="noopener noreferrer">')
                return
        self.parts.append(f"<{tag}>")

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in self.allowed_tags:
            self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        self.parts.append(html.escape(data))

    def get_html(self):
        return "".join(self.parts).strip()


def sanitize_rich_html(value):
    sanitizer = RichTextSanitizer()
    sanitizer.feed(str(value or ""))
    sanitizer.close()
    return sanitizer.get_html()


def parse_scaled_number(value, field_name="数值"):
    raw = str(value or "").strip()
    if not raw:
        return 0

    normalized = raw.replace(",", "").replace("％", "%").replace(" ", "")
    if normalized.endswith("%"):
        normalized = normalized[:-1]

    composite_multiplier = None
    for composite_suffix, multiplier_value in (("万亿", 1_000_000_000_000), ("萬億", 1_000_000_000_000)):
        if normalized.endswith(composite_suffix):
            composite_multiplier = multiplier_value
            normalized = normalized[:-len(composite_suffix)]
            break

    units = {
        "k": 1_000,
        "K": 1_000,
        "千": 1_000,
        "w": 10_000,
        "W": 10_000,
        "万": 10_000,
        "亿": 100_000_000,
    }

    multiplier = composite_multiplier or 1
    if composite_multiplier is None:
        suffix = normalized[-1:] if normalized else ""
        if suffix in units:
            multiplier = units[suffix]
            normalized = normalized[:-1]

    try:
        return round(float(normalized or "0") * multiplier, 4)
    except ValueError as exc:
        raise ValueError(f"{field_name}格式不正确，支持小数，也支持万、亿、万亿等单位") from exc


def format_number(value):
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        return "0"

    sign = "-" if number < 0 else ""
    abs_number = abs(number)
    units = [
        ("万亿", 1_000_000_000_000),
        ("亿", 100_000_000),
        ("万", 10_000),
    ]
    for unit, divisor in units:
        if abs_number >= divisor:
            scaled = abs_number / divisor
            text = f"{scaled:.2f}".rstrip("0").rstrip(".")
            return f"{sign}{text}{unit}"
    if abs_number.is_integer():
        return f"{sign}{int(abs_number)}"
    return f"{sign}{abs_number:.2f}".rstrip("0").rstrip(".")


def hash_password(password: str, salt: str) -> str:
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return hashed.hex()


def open_db():
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def build_guild_display_name(guild_code, guild_prefix, guild_name):
    parts = [str(guild_code or "").strip(), str(guild_prefix or "").strip(), str(guild_name or "").strip()]
    return " ".join(part for part in parts if part)


def build_guild_key(guild_code, guild_prefix, guild_name):
    return "|".join([
        str(guild_code or "").strip(),
        str(guild_prefix or "").strip(),
        str(guild_name or "").strip(),
    ])


def upsert_guild_registry(connection, member, leader_name=None):
    guild_key = build_guild_key(member.get("guild_code", ""), member.get("guild_prefix", ""), member.get("guild", ""))
    if not guild_key:
        return
    connection.execute(
        """
        INSERT INTO guild_registry (
            guild_key, alliance, hill, guild_code, guild_prefix, guild, guild_power, leader_name, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guild_key) DO UPDATE SET
            alliance = excluded.alliance,
            hill = excluded.hill,
            guild_code = excluded.guild_code,
            guild_prefix = excluded.guild_prefix,
            guild = excluded.guild,
            guild_power = excluded.guild_power,
            leader_name = excluded.leader_name,
            updated_at = excluded.updated_at
        """,
        (
            guild_key,
            member.get("alliance", "🔮联盟"),
            member.get("hill", "默认山头"),
            member.get("guild_code", ""),
            member.get("guild_prefix", ""),
            member.get("guild", ""),
            int(member.get("guild_power", 0) or 0),
            leader_name if leader_name is not None else member.get("name", ""),
            member.get("updated_at") or member.get("created_at") or now_text(),
        ),
    )


def guild_exists(connection, guild_code, guild_prefix, guild_name, exclude_key=None):
    conditions = []
    params = []
    if str(guild_code or "").strip():
        conditions.append("guild_code = ?")
        params.append(str(guild_code).strip())
    else:
        conditions.append("guild_prefix = ? AND guild = ?")
        params.extend([str(guild_prefix or "").strip(), str(guild_name or "").strip()])
    if exclude_key:
        conditions.append("guild_key <> ?")
        params.append(exclude_key)
    query = f"SELECT guild_key FROM guild_registry WHERE {' AND '.join(conditions)} LIMIT 1"
    return connection.execute(query, tuple(params)).fetchone()


def member_name_exists(connection, guild_code, guild_prefix, guild_name, member_name, exclude_id=None):
    query = """
        SELECT id FROM members
        WHERE guild_code = ? AND guild_prefix = ? AND guild = ? AND name = ?
    """
    params = [str(guild_code or "").strip(), str(guild_prefix or "").strip(), str(guild_name or "").strip(), str(member_name or "").strip()]
    if exclude_id is not None:
        query += " AND id <> ?"
        params.append(exclude_id)
    query += " LIMIT 1"
    return connection.execute(query, tuple(params)).fetchone()


def initialize_database():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
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
                created_at TEXT NOT NULL,
                author TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS guild_registry (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_key TEXT NOT NULL UNIQUE,
                alliance TEXT NOT NULL,
                hill TEXT NOT NULL DEFAULT '默认山头',
                guild_code TEXT NOT NULL DEFAULT '',
                guild_prefix TEXT NOT NULL DEFAULT '',
                guild TEXT NOT NULL,
                guild_power INTEGER NOT NULL DEFAULT 0,
                leader_name TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
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
                screenshot_path TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )

        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS member_cert_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                member_id INTEGER NOT NULL,
                alliance TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                reviewed_at TEXT,
                reviewer_id INTEGER
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_role_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                alliance TEXT NOT NULL,
                request_type TEXT NOT NULL DEFAULT 'guild',
                status TEXT NOT NULL DEFAULT 'pending',
                is_read INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                read_at TEXT,
                reviewed_at TEXT,
                reviewer_id INTEGER
            )
            """
        )
        admin_role_request_columns = [row["name"] for row in connection.execute("PRAGMA table_info(admin_role_requests)").fetchall()]
        if "is_read" not in admin_role_request_columns:
            connection.execute("ALTER TABLE admin_role_requests ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0")
        if "read_at" not in admin_role_request_columns:
            connection.execute("ALTER TABLE admin_role_requests ADD COLUMN read_at TEXT")
        if "request_type" not in admin_role_request_columns:
            connection.execute("ALTER TABLE admin_role_requests ADD COLUMN request_type TEXT NOT NULL DEFAULT 'guild'")

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
        if "verified" not in columns:
            connection.execute("ALTER TABLE members ADD COLUMN verified INTEGER NOT NULL DEFAULT 0")
        if "screenshot_path" not in columns:
            connection.execute("ALTER TABLE members ADD COLUMN screenshot_path TEXT NOT NULL DEFAULT ''")

        announcement_columns = [row["name"] for row in connection.execute("PRAGMA table_info(announcements)").fetchall()]
        if "author" not in announcement_columns:
            connection.execute("ALTER TABLE announcements ADD COLUMN author TEXT NOT NULL DEFAULT ''")

        # 迁移 guild_registry 表：添加 id 字段（如果不存在）
        guild_registry_columns = [row["name"] for row in connection.execute("PRAGMA table_info(guild_registry)").fetchall()]
        if "id" not in guild_registry_columns:
            # 为现有记录添加自增 id
            # 先创建一个临时表带 id 列，然后复制数据
            connection.execute("""
                CREATE TABLE IF NOT EXISTS guild_registry_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    guild_key TEXT NOT NULL UNIQUE,
                    alliance TEXT NOT NULL,
                    hill TEXT NOT NULL DEFAULT '默认山头',
                    guild_code TEXT NOT NULL DEFAULT '',
                    guild_prefix TEXT NOT NULL DEFAULT '',
                    guild TEXT NOT NULL,
                    guild_power INTEGER NOT NULL DEFAULT 0,
                    leader_name TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                )
            """)
            # 复制现有数据
            connection.execute("""
                INSERT INTO guild_registry_new (guild_key, alliance, hill, guild_code, guild_prefix, guild, guild_power, leader_name, updated_at)
                SELECT guild_key, alliance, hill, guild_code, guild_prefix, guild, guild_power, leader_name, updated_at FROM guild_registry
            """)
            # 删除旧表并重命名新表
            connection.execute("DROP TABLE guild_registry")
            connection.execute("ALTER TABLE guild_registry_new RENAME TO guild_registry")
            # 重建索引
            connection.execute("CREATE INDEX IF NOT EXISTS idx_guild_registry_code_lookup ON guild_registry(guild_code)")

        connection.execute("CREATE INDEX IF NOT EXISTS idx_members_guild_name_lookup ON members(guild_code, guild_prefix, guild, name)")

        announcement_count = connection.execute("SELECT COUNT(*) AS count FROM announcements").fetchone()["count"]
        if announcement_count == 0:
            seed_announcements = [
                ("联盟招新开启", "本周开放 2 个妖盟名额，要求活跃、配合填表。", "公告"),
                ("周日晚联盟战", "请各妖盟于 20:00 前同步主力战力和灵兽配置。", "公告"),
                ("天狐妖盟昨晚冲榜成功", "前三主力全部破 30 万战，今天已经坐稳联盟第一梯队。", "瓜棚"),
                ("玄龟妖盟准备换阵", "据说正在测试双反击流，有望下周冲进前二。", "瓜棚"),
            ]
            connection.executemany(
                "INSERT INTO announcements (title, content, category, created_at, author) VALUES (?, ?, ?, ?, ?)",
                [(title, content, category, now_text(), "系统") for title, content, category in seed_announcements],
            )

        member_count = connection.execute("SELECT COUNT(*) AS count FROM members").fetchone()["count"]
        if member_count == 0:
            timestamp = now_text()
            seed_members = [
                ("🔮联盟", "蓬莱1-方丈12", "833", "长虹山", 865200, "天狐妖盟", "青玄子", "盟主", "化神后期", 328000, 98000, 23500, 16800, 9200, "应龙", "主修暴击流，负责联盟指挥。", timestamp, timestamp),
                ("🔮联盟", "方丈13-瀛洲4", "612", "望月山", 612800, "玄龟妖盟", "白芷", "副盟主", "元婴圆满", 285600, 86200, 21000, 15200, 10100, "九尾狐", "负责资源统计与招新审核。", timestamp, timestamp),
                ("🔮联盟", "蓬莱1-方丈12", "501", "赤羽山", 501300, "赤羽妖盟", "曜尘", "长老", "元婴后期", 243500, 79800, 18700, 14500, 8800, "玄龟", "主抗伤阵容，联盟战前排。", timestamp, timestamp),
            ]
            connection.executemany(
                """
                INSERT INTO members (
                    alliance, hill, guild_code, guild_prefix, guild_power, guild, name, role, realm, power, hp, attack, defense, speed, pet, note, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                seed_members,
            )

        registry_count = connection.execute("SELECT COUNT(*) AS count FROM guild_registry").fetchone()["count"]
        if registry_count == 0:
            rows = [dict(row) for row in connection.execute("SELECT * FROM members ORDER BY updated_at DESC, id DESC").fetchall()]
            grouped = {}
            for row in rows:
                key = build_guild_key(row.get("guild_code", ""), row.get("guild_prefix", ""), row.get("guild", ""))
                if not key:
                    continue
                entry = grouped.setdefault(key, {**row})
                entry["guild_power"] = max(int(entry.get("guild_power", 0) or 0), int(row.get("guild_power", 0) or 0))
                if row.get("role") == "盟主" and row.get("name"):
                    entry["name"] = row["name"]
            for entry in grouped.values():
                upsert_guild_registry(connection, entry)

        connection.execute("UPDATE members SET alliance = '🔮联盟' WHERE alliance = '青云联盟'")

        connection.commit()


def cleanup_sessions():
    current = datetime.now().timestamp()
    expired = [token for token, value in sessions.items() if current - value["created_at"] > SESSION_TTL_SECONDS]
    for token in expired:
        sessions.pop(token, None)

def validate_member(payload):
    allow_empty_name = bool(payload.get("allow_empty_name"))
    member = {
        "alliance": str(payload.get("alliance", "")).strip() or "🔮联盟",
        "hill": str(payload.get("hill", "")).strip() or "默认山头",
        "guild_code": str(payload.get("guild_code", "")).strip(),
        "guild_prefix": str(payload.get("guild_prefix", "")).strip(),
        "guild_power": parse_scaled_number(payload.get("guild_power", 0), "妖盟总战力"),
        "guild": str(payload.get("guild", "")).strip(),
        "name": str(payload.get("name", "")).strip(),
        "role": str(payload.get("role", "")).strip() or "成员",
        "realm": str(payload.get("realm", "")).strip() or "待补充",
        "power": parse_scaled_number(payload.get("power", 0), "战力"),
        "hp": parse_scaled_number(payload.get("hp", 0), "生命"),
        "attack": parse_scaled_number(payload.get("attack", 0), "攻击"),
        "defense": parse_scaled_number(payload.get("defense", 0), "防御"),
        "speed": parse_scaled_number(payload.get("speed", 0), "敏捷"),
        "bonus_damage": parse_scaled_number(payload.get("bonus_damage", 0), "增伤"),
        "damage_reduction": parse_scaled_number(payload.get("damage_reduction", 0), "减伤"),
        "pet": str(payload.get("pet", "")).strip() or "待补充",
        "note": str(payload.get("note", "")).strip(),
        "screenshot_path": str(payload.get("screenshot_path", "")).strip(),
    }
    if not member["guild"]:
        raise ValueError("妖盟不能为空")
    if not member["name"] and member["role"] != "盟主" and not allow_empty_name:
        raise ValueError("成员昵称不能为空")
    return member


def validate_guild(payload):
    guild = {
        "alliance": str(payload.get("alliance", "")).strip() or "🔮联盟",
        "hill": str(payload.get("hill", "")).strip() or str(payload.get("alliance", "")).strip() or "🔮联盟",
        "guild_code": str(payload.get("guild_code", "")).strip(),
        "guild_prefix": str(payload.get("guild_prefix", "")).strip(),
        "guild_power": parse_scaled_number(payload.get("guild_power", 0), "妖盟总战力"),
        "guild": str(payload.get("guild", "")).strip(),
        "leader_name": str(payload.get("leader_name", "")).strip(),
    }
    if not guild["guild"]:
        raise ValueError("妖盟不能为空")
    return guild


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
        "verified": bool(member.get("verified", 0)),
        "screenshot_url": member.get("screenshot_path", ""),
        "has_screenshot": bool(member.get("screenshot_path")),
        "created_at": member.get("created_at"),
        "updated_at": member.get("updated_at"),
    }
