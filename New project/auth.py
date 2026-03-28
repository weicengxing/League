"""
认证服务模块 - 处理用户注册、登录、邮箱验证和密码找回
"""
import hashlib
import hmac
import json
import logging
import secrets
import smtplib
import sqlite3
import sys
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from http import HTTPStatus
from http.cookies import SimpleCookie
from urllib.parse import parse_qs, urlparse

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "alliance.db"
logger = logging.getLogger(__name__)
USER_SESSION_COOKIE = "user_session"
USER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7  # 7天

# 邮件配置 - 请根据实际情况修改（与 server.py 保持一致）
SMTP_CONFIG = {
    "host": "smtp.qq.com",
    "port": 587,
    "use_tls": True,
    "username": "2629430873@qq.com",
    "password": "obvszlnbldobeacd",
    "from_name": "寻道大千联盟",
}

# 注册验证码存储: {email_lower: {"code": "...", "expire": datetime, "sent_at": timestamp}}
register_verify_codes = {}
user_sessions = {}


def now_text():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def hash_password(password: str, salt: str) -> str:
    """使用 PBKDF2 哈希密码"""
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120_000)
    return hashed.hex()


def generate_verify_code(length: int = 6) -> str:
    """生成数字验证码"""
    return "".join(secrets.choice("0123456789") for _ in range(length))


def send_email(to_email: str, subject: str, html_content: str) -> bool:
    """发送邮件"""
    try:
        logger.info(
            "Mail send start: to=%s subject=%s host=%s port=%s tls=%s from=%s",
            mask_email(to_email),
            subject,
            SMTP_CONFIG.get("host"),
            SMTP_CONFIG.get("port"),
            SMTP_CONFIG.get("use_tls", True),
            SMTP_CONFIG.get("username"),
        )
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_CONFIG["username"]
        msg["To"] = to_email

        # HTML 内容
        html_part = MIMEText(html_content, "html", "utf-8")
        msg.attach(html_part)

        # 连接 SMTP 服务器
        server = smtplib.SMTP(SMTP_CONFIG["host"], SMTP_CONFIG["port"])
        if SMTP_CONFIG.get("use_tls", True):
            server.starttls()
        
        server.login(SMTP_CONFIG["username"], SMTP_CONFIG["password"])
        server.sendmail(SMTP_CONFIG["username"], [to_email], msg.as_string())
        server.quit()
        logger.info("Mail send success: to=%s", mask_email(to_email))
        return True
    except Exception as e:
        logger.exception("Mail send failed: to=%s", mask_email(to_email))
        print(f"发送邮件失败: {e}", file=sys.stderr)
        return False


def open_db():
    """打开数据库连接"""
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_auth_database():
    """初始化认证相关的数据库表"""
    with open_db() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                email TEXT NOT NULL UNIQUE,
                member_id INTEGER,
                password_hash TEXT NOT NULL,
                salt TEXT NOT NULL,
                verify_code TEXT,
                verify_expire TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            """
        )
        columns = [row["name"] for row in connection.execute("PRAGMA table_info(users)").fetchall()]
        if "member_id" not in columns:
            connection.execute("ALTER TABLE users ADD COLUMN member_id INTEGER")
        connection.commit()


def cleanup_user_sessions():
    """清理过期的会话"""
    current = datetime.now().timestamp()
    expired = [token for token, value in user_sessions.items() if current - value["created_at"] > USER_SESSION_TTL_SECONDS]
    for token in expired:
        user_sessions.pop(token, None)


def read_session_token_from_handler(handler):
    cookie_header = handler.headers.get("Cookie")
    if not cookie_header:
        return None
    cookie = SimpleCookie()
    cookie.load(cookie_header)
    morsel = cookie.get(USER_SESSION_COOKIE)
    return morsel.value if morsel else None


def get_session_from_handler(handler):
    token = read_session_token_from_handler(handler)
    if not token:
        return None
    return user_sessions.get(token)


def get_current_auth(handler):
    session = get_session_from_handler(handler)
    if not session:
        return {"authenticated": False, "user": None, "is_admin": False}

    user = {
        "id": session["user_id"],
        "username": session["username"],
        "is_admin": bool(session.get("is_admin")),
    }
    if session.get("is_admin"):
        user["display_name"] = session.get("display_name", session["username"])
    else:
        user["email"] = session.get("email")
        user["member_id"] = session.get("member_id")

    return {
        "authenticated": True,
        "user": user,
        "is_admin": bool(session.get("is_admin")),
    }


def ensure_member_binding(connection, user_row):
    """尝试按用户名自动关联同名成员，避免普通用户登录后没有个人档案。"""
    member_id = user_row["member_id"] if "member_id" in user_row.keys() else None
    if member_id:
        return member_id

    try:
        matches = connection.execute(
            "SELECT id FROM members WHERE name = ? ORDER BY id ASC",
            (user_row["username"],),
        ).fetchall()
    except sqlite3.OperationalError:
        return None

    if len(matches) != 1:
        return None

    member_id = matches[0]["id"]
    existing = connection.execute(
        "SELECT id FROM users WHERE member_id = ? AND id != ?",
        (member_id, user_row["id"]),
    ).fetchone()
    if existing:
        return None

    connection.execute(
        "UPDATE users SET member_id = ? WHERE id = ?",
        (member_id, user_row["id"]),
    )
    connection.commit()
    return member_id


class AuthHandler:
    """认证请求处理器"""

    def __init__(self, handler):
        self.handler = handler

    def handle(self):
        """根据请求方法和路径分发处理"""
        cleanup_user_sessions()
        parsed = urlparse(self.handler.path)
        
        if self.handler.command == "GET":
            return self.handle_get(parsed)
        elif self.handler.command == "POST":
            return self.handle_post(parsed)
        else:
            self.handler.send_error(HTTPStatus.METHOD_NOT_ALLOWED)
            return None

    def handle_get(self, parsed):
        """处理 GET 请求"""
        if parsed.path == "/api/auth/me":
            return self.get_current_user()
        self.handler.send_error(HTTPStatus.NOT_FOUND)
        return None

    def handle_post(self, parsed):
        """处理 POST 请求"""
        if parsed.path == "/api/auth/register-verify":
            return self.send_register_verify_code()
        elif parsed.path == "/api/auth/register":
            return self.register()
        elif parsed.path == "/api/auth/login":
            return self.login()
        elif parsed.path == "/api/auth/logout":
            return self.logout()
        elif parsed.path == "/api/auth/verify":
            return self.send_verify_code()
        elif parsed.path == "/api/auth/reset":
            return self.reset_password()
        elif parsed.path == "/api/auth/check":
            return self.check_session()
        self.handler.send_error(HTTPStatus.NOT_FOUND)
        return None

    def register(self):
        """用户注册"""
        payload = self.read_json()
        
        username = str(payload.get("username", "")).strip()
        email = str(payload.get("email", "")).strip()
        password = str(payload.get("password", "")).strip()
        confirm_password = str(payload.get("confirmPassword", "")).strip()

        # 验证输入
        if not username or not email or not password:
            return self.send_json({"error": "用户名、邮箱和密码不能为空"}, HTTPStatus.BAD_REQUEST)
        
        if len(username) < 3 or len(username) > 20:
            return self.send_json({"error": "用户名长度应在 3-20 个字符之间"}, HTTPStatus.BAD_REQUEST)
        
        if not email.endswith("@qq.com") and not email.endswith("@outlook.com") and not email.endswith("@gmail.com"):
            return self.send_json({"error": "仅支持 @qq.com、@outlook.com、@gmail.com 邮箱注册"}, HTTPStatus.BAD_REQUEST)

        # 验证邮箱验证码
        verify_code = str(payload.get("verifyCode", "")).strip()
        if not verify_code:
            return self.send_json({"error": "请输入邮箱验证码"}, HTTPStatus.BAD_REQUEST)

        email_lower = email.lower()
        stored = register_verify_codes.get(email_lower)
        if not stored:
            return self.send_json({"error": "请先发送邮箱验证码"}, HTTPStatus.BAD_REQUEST)

        if stored["code"] != verify_code:
            return self.send_json({"error": "验证码错误"}, HTTPStatus.UNAUTHORIZED)

        if datetime.now() > stored["expire"]:
            register_verify_codes.pop(email_lower, None)
            return self.send_json({"error": "验证码已过期，请重新获取"}, HTTPStatus.UNAUTHORIZED)

        if len(password) < 6:
            return self.send_json({"error": "密码长度不能少于 6 位"}, HTTPStatus.BAD_REQUEST)
        
        if password != confirm_password:
            return self.send_json({"error": "两次输入的密码不一致"}, HTTPStatus.BAD_REQUEST)

        # 检查用户名和邮箱是否已存在
        with open_db() as connection:
            existing_user = connection.execute(
                "SELECT id FROM users WHERE username = ? OR email = ?", (username, email)
            ).fetchone()
            
            if existing_user:
                return self.send_json({"error": "用户名或邮箱已被注册"}, HTTPStatus.CONFLICT)

            # 注册成功，清除验证码
            register_verify_codes.pop(email_lower, None)

            # 创建新用户
            salt = secrets.token_hex(16)
            password_hash = hash_password(password, salt)
            timestamp = now_text()
            
            connection.execute(
                """
                INSERT INTO users (username, email, password_hash, salt, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (username, email, password_hash, salt, 1, timestamp),
            )
            connection.commit()

        return self.send_json({"message": "注册成功", "username": username}, HTTPStatus.CREATED)

    def send_register_verify_code(self):
        """发送注册验证码到邮箱"""
        payload = self.read_json()
        email = str(payload.get("email", "")).strip()

        if not email:
            return self.send_json({"error": "邮箱地址不能为空"}, HTTPStatus.BAD_REQUEST)

        if not email.endswith("@qq.com") and not email.endswith("@outlook.com") and not email.endswith("@gmail.com"):
            return self.send_json({"error": "仅支持 @qq.com、@outlook.com、@gmail.com 邮箱注册"}, HTTPStatus.BAD_REQUEST)

        email_lower = email.lower()

        # 频率限制：60秒内不能重复发送
        stored = register_verify_codes.get(email_lower)
        current_ts = datetime.now().timestamp()
        if stored and current_ts - stored["sent_at"] < 60:
            remaining = int(60 - (current_ts - stored["sent_at"]))
            return self.send_json({"error": f"请 {remaining} 秒后再试"}, HTTPStatus.TOO_MANY_REQUESTS)

        # 检查邮箱是否已注册
        with open_db() as connection:
            existing = connection.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
            if existing:
                return self.send_json({"error": "该邮箱已被注册"}, HTTPStatus.CONFLICT)

        # 生成验证码
        verify_code = generate_verify_code(6)
        expire_time = datetime.now() + timedelta(minutes=15)

        register_verify_codes[email_lower] = {
            "code": verify_code,
            "expire": expire_time,
            "sent_at": current_ts,
        }

        # 发送邮件
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {{ font-family: 'Microsoft YaHei', Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px; }}
                .container {{ max-width: 500px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
                .header {{ background: linear-gradient(135deg, #56ab2f 0%, #a8e063 100%); color: white; padding: 30px; text-align: center; }}
                .header h1 {{ margin: 0; font-size: 24px; }}
                .content {{ padding: 30px; text-align: center; }}
                .code {{ font-size: 36px; font-weight: bold; color: #56ab2f; letter-spacing: 8px; margin: 20px 0; }}
                .tip {{ color: #666; font-size: 14px; line-height: 1.6; }}
                .footer {{ background: #f9f9f9; padding: 15px; text-align: center; color: #999; font-size: 12px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🌿 注册验证码</h1>
                </div>
                <div class="content">
                    <p>您好，欢迎注册寻道大千联盟</p>
                    <p class="code">{verify_code}</p>
                    <p class="tip">验证码 15 分钟内有效，请勿泄露给他人</p>
                    <p class="tip">如果不是您本人操作，请忽略此邮件</p>
                </div>
                <div class="footer">
                    寻道大千联盟信息站 · 请勿回复此邮件
                </div>
            </div>
        </body>
        </html>
        """

        success = send_email(email, "【寻道大千】注册验证码", html_content)

        if success:
            return self.send_json({"message": "验证码已发送到邮箱", "email": mask_email(email)})
        else:
            register_verify_codes.pop(email_lower, None)
            return self.send_json({"error": "发送验证码失败，请检查邮箱地址或稍后重试"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def login(self):
        """用户登录 - 同时支持管理员和普通用户"""
        payload = self.read_json()
        
        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", "")).strip()

        if not username or not password:
            return self.send_json({"error": "用户名和密码不能为空"}, HTTPStatus.BAD_REQUEST)

        with open_db() as connection:
            # 先查询管理员表
            admin_row = connection.execute(
                "SELECT * FROM admins WHERE username = ?", (username,)
            ).fetchone()
            
            if admin_row:
                # 验证管理员密码
                calculated = hash_password(password, admin_row["salt"])
                if not hmac.compare_digest(calculated, admin_row["password_hash"]):
                    return self.send_json({"error": "用户名或密码错误"}, HTTPStatus.UNAUTHORIZED)
                
                # 管理员登录成功
                token = secrets.token_hex(24)
                user_sessions[token] = {
                    "user_id": admin_row["id"],
                    "username": admin_row["username"],
                    "display_name": admin_row["display_name"],
                    "email": None,
                    "is_admin": True,
                    "created_at": datetime.now().timestamp(),
                }
                
                self.handler.send_response(HTTPStatus.OK)
                self.handler.send_header("Content-Type", "application/json; charset=utf-8")
                self.handler.send_header(
                    "Set-Cookie",
                    f"{USER_SESSION_COOKIE}={token}; HttpOnly; Path=/; Max-Age={USER_SESSION_TTL_SECONDS}; SameSite=Lax"
                )
                self.handler.end_headers()
                self.handler.wfile.write(
                    json.dumps({
                        "message": "管理员登录成功",
                        "is_admin": True,
                        "user": {
                            "id": admin_row["id"],
                            "username": admin_row["username"],
                            "display_name": admin_row["display_name"],
                        }
                    }, ensure_ascii=False).encode("utf-8")
                )
                return

            # 再查询普通用户表
            row = connection.execute(
                "SELECT * FROM users WHERE username = ? OR email = ?", (username, username)
            ).fetchone()

            if not row:
                return self.send_json({"error": "用户名或密码错误"}, HTTPStatus.UNAUTHORIZED)

            calculated = hash_password(password, row["salt"])
            if not hmac.compare_digest(calculated, row["password_hash"]):
                return self.send_json({"error": "用户名或密码错误"}, HTTPStatus.UNAUTHORIZED)

            if not row["is_active"]:
                return self.send_json({"error": "账号已被禁用"}, HTTPStatus.FORBIDDEN)

            # 普通用户登录成功
            member_id = ensure_member_binding(connection, row)
            token = secrets.token_hex(24)
            user_sessions[token] = {
                "user_id": row["id"],
                "username": row["username"],
                "email": row["email"],
                "member_id": member_id,
                "is_admin": False,
                "created_at": datetime.now().timestamp(),
            }

            self.handler.send_response(HTTPStatus.OK)
            self.handler.send_header("Content-Type", "application/json; charset=utf-8")
            self.handler.send_header(
                "Set-Cookie",
                f"{USER_SESSION_COOKIE}={token}; HttpOnly; Path=/; Max-Age={USER_SESSION_TTL_SECONDS}; SameSite=Lax"
            )
            self.handler.end_headers()
            self.handler.wfile.write(
                json.dumps({
                    "message": "登录成功",
                        "is_admin": False,
                        "user": {
                            "id": row["id"],
                            "username": row["username"],
                            "email": row["email"],
                            "member_id": member_id,
                        }
                    }, ensure_ascii=False).encode("utf-8")
            )

    def logout(self):
        """用户登出"""
        token = self.read_session_token()
        if token:
            user_sessions.pop(token, None)

        self.handler.send_response(HTTPStatus.OK)
        self.handler.send_header("Content-Type", "application/json; charset=utf-8")
        self.handler.send_header(
            "Set-Cookie",
            f"{USER_SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"
        )
        self.handler.end_headers()
        self.handler.wfile.write(json.dumps({"message": "已退出登录"}, ensure_ascii=False).encode("utf-8"))

    def send_verify_code(self):
        """发送验证码到邮箱"""
        payload = self.read_json()
        email = str(payload.get("email", "")).strip()
        logger.info("Forgot-password verify request received: email=%s", mask_email(email))

        if not email:
            logger.warning("Forgot-password verify rejected: empty email")
            return self.send_json({"error": "邮箱地址不能为空"}, HTTPStatus.BAD_REQUEST)

        # 检查邮箱是否已注册
        with open_db() as connection:
            row = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            
            if not row:
                logger.warning("Forgot-password verify rejected: email not registered: %s", mask_email(email))
                return self.send_json({"error": "该邮箱未注册"}, HTTPStatus.NOT_FOUND)

        # 生成验证码
        verify_code = generate_verify_code(6)
        expire_time = (datetime.now() + timedelta(minutes=15)).strftime("%Y-%m-%d %H:%M:%S")
        timestamp = now_text()

        # 保存验证码到数据库
        with open_db() as connection:
            connection.execute(
                "UPDATE users SET verify_code = ?, verify_expire = ? WHERE email = ?",
                (verify_code, expire_time, email),
            )
            connection.commit()
        logger.info("Forgot-password verify code stored: email=%s expire=%s", mask_email(email), expire_time)

        # 发送邮件
        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                body {{ font-family: 'Microsoft YaHei', Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 20px; }}
                .container {{ max-width: 500px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }}
                .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }}
                .header h1 {{ margin: 0; font-size: 24px; }}
                .content {{ padding: 30px; text-align: center; }}
                .code {{ font-size: 36px; font-weight: bold; color: #667eea; letter-spacing: 8px; margin: 20px 0; }}
                .tip {{ color: #666; font-size: 14px; line-height: 1.6; }}
                .footer {{ background: #f9f9f9; padding: 15px; text-align: center; color: #999; font-size: 12px; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🔑 找回密码验证码</h1>
                </div>
                <div class="content">
                    <p>您好，您正在找回密码</p>
                    <p class="code">{verify_code}</p>
                    <p class="tip">验证码 15 分钟内有效，请勿泄露给他人</p>
                    <p class="tip">如果不是您本人操作，请忽略此邮件</p>
                </div>
                <div class="footer">
                    寻道大千联盟信息站 · 请勿回复此邮件
                </div>
            </div>
        </body>
        </html>
        """

        success = send_email(email, "【寻道大千】找回密码验证码", html_content)
        logger.info("Forgot-password verify send_email returned: email=%s", mask_email(email))
        
        if success:
            logger.info("Forgot-password verify response success: email=%s", mask_email(email))
            return self.send_json({"message": "验证码已发送到邮箱", "email": mask_email(email)})
        else:
            logger.error("Forgot-password verify response failed after send_email: email=%s", mask_email(email))
            return self.send_json({"error": "发送验证码失败，请检查邮箱地址或稍后重试"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def reset_password(self):
        """重置密码"""
        payload = self.read_json()
        email = str(payload.get("email", "")).strip()
        verify_code = str(payload.get("verifyCode", "")).strip()
        new_password = str(payload.get("newPassword", "")).strip()
        confirm_password = str(payload.get("confirmPassword", "")).strip()
        logger.info(
            "Forgot-password reset request received: email=%s code_len=%s password_len=%s",
            mask_email(email),
            len(verify_code),
            len(new_password),
        )

        if not email or not verify_code or not new_password:
            logger.warning("Forgot-password reset rejected: missing fields email=%s", mask_email(email))
            return self.send_json({"error": "邮箱、验证码和新密码不能为空"}, HTTPStatus.BAD_REQUEST)

        if new_password != confirm_password:
            logger.warning("Forgot-password reset rejected: password mismatch email=%s", mask_email(email))
            return self.send_json({"error": "两次输入的密码不一致"}, HTTPStatus.BAD_REQUEST)

        if len(new_password) < 6:
            logger.warning("Forgot-password reset rejected: password too short email=%s", mask_email(email))
            return self.send_json({"error": "密码长度不能少于 6 位"}, HTTPStatus.BAD_REQUEST)

        # 验证验证码
        with open_db() as connection:
            row = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            
            if not row:
                logger.warning("Forgot-password reset rejected: user not found email=%s", mask_email(email))
                return self.send_json({"error": "用户不存在"}, HTTPStatus.NOT_FOUND)

            if row["verify_code"] != verify_code:
                logger.warning("Forgot-password reset rejected: code mismatch email=%s", mask_email(email))
                return self.send_json({"error": "验证码错误"}, HTTPStatus.UNAUTHORIZED)

            expire_time = datetime.strptime(row["verify_expire"], "%Y-%m-%d %H:%M:%S")
            if datetime.now() > expire_time:
                logger.warning("Forgot-password reset rejected: code expired email=%s expire=%s", mask_email(email), row["verify_expire"])
                return self.send_json({"error": "验证码已过期，请重新获取"}, HTTPStatus.UNAUTHORIZED)

            # 更新密码
            salt = secrets.token_hex(16)
            password_hash = hash_password(new_password, salt)
            
            connection.execute(
                "UPDATE users SET password_hash = ?, salt = ?, verify_code = NULL, verify_expire = NULL WHERE email = ?",
                (password_hash, salt, email),
            )
            connection.commit()
        logger.info("Forgot-password reset success: email=%s", mask_email(email))

        return self.send_json({"message": "密码重置成功，请使用新密码登录"})

    def get_current_user(self):
        """获取当前登录用户信息"""
        return self.send_json(get_current_auth(self.handler))

    def check_session(self):
        """检查会话是否有效"""
        session = get_session_from_handler(self.handler)
        if not session:
            return self.send_json({"valid": False, "user": None})

        user_info = {
            "id": session["user_id"],
            "username": session["username"],
        }
        
        if session.get("is_admin"):
            user_info["display_name"] = session.get("display_name", session["username"])
            user_info["is_admin"] = True
            return self.send_json({"valid": True, "type": "admin", "user": user_info})
        else:
            user_info["email"] = session.get("email")
            user_info["is_admin"] = False
            return self.send_json({"valid": True, "type": "user", "user": user_info})

    def get_current_user_from_session(self):
        """从会话获取当前用户"""
        session = get_session_from_handler(self.handler)
        if not session:
            return None
        if session.get("is_admin"):
            return None
        return {
            "id": session["user_id"],
            "username": session["username"],
            "email": session["email"],
            "member_id": session.get("member_id"),
        }

    def get_current_admin_from_session(self):
        """从管理员会话获取当前管理员"""
        session = get_session_from_handler(self.handler)
        if not session or not session.get("is_admin"):
            return None
        return {
            "id": session["user_id"],
            "username": session["username"],
            "display_name": session.get("display_name", session["username"]),
            "is_admin": True,
        }

    def read_session_token(self):
        """读取会话 Token"""
        return read_session_token_from_handler(self.handler)

    def read_json(self):
        """读取 JSON 请求体"""
        length = int(self.handler.headers.get("Content-Length", "0"))
        raw = self.handler.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json({"error": "JSON 格式不正确"}, HTTPStatus.BAD_REQUEST)
            raise

    def send_json(self, payload, status=HTTPStatus.OK):
        """发送 JSON 响应"""
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.handler.send_response(status)
        self.handler.send_header("Content-Type", "application/json; charset=utf-8")
        self.handler.send_header("Content-Length", str(len(data)))
        self.handler.end_headers()
        self.handler.wfile.write(data)


def mask_email(email: str) -> str:
    """隐藏邮箱中间部分"""
    if "@" not in email:
        return email
    local, domain = email.split("@")
    if len(local) <= 3:
        return f"{local[0]}***@{domain}"
    return f"{local[:2]}***@{domain}"


def require_user(handler) -> dict | None:
    """验证用户是否登录"""
    session = get_session_from_handler(handler)
    if not session:
        return None
    if session.get("is_admin"):
        return {
            "id": session["user_id"],
            "username": session["username"],
            "display_name": session.get("display_name", session["username"]),
            "is_admin": True,
        }
    return {
        "id": session["user_id"],
        "username": session["username"],
        "email": session["email"],
        "member_id": session.get("member_id"),
        "is_admin": False,
    }


if __name__ == "__main__":
    # 初始化数据库
    initialize_auth_database()
    print("认证数据库初始化完成")
