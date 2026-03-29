from alliance_server.shared import *

from auth import (
    ROLE_ALLIANCEADMIN,
    ROLE_GUEST,
    ROLE_SUPERADMIN,
    ROLE_VERIFIEDUSER,
    update_user_sessions_for_user,
)

class ReviewRequestsMixin:
    def get_known_alliances(self, connection):
        rows = connection.execute(
            """
            SELECT DISTINCT hill
            FROM members
            WHERE hill IS NOT NULL AND hill != ''
            ORDER BY hill COLLATE NOCASE ASC
            """
        ).fetchall()
        return [row["hill"] for row in rows]

    def get_known_guilds(self, connection):
        rows = connection.execute(
            """
            SELECT DISTINCT guild
            FROM guild_registry
            WHERE guild IS NOT NULL AND guild != ''
            ORDER BY guild COLLATE NOCASE ASC
            """
        ).fetchall()
        return [row["guild"] for row in rows]

    def get_guilds_for_league_scope(self, connection, request_type, target_name):
        scope_type = str(request_type or ROLE_REQUEST_TYPE_GUILD).strip().lower()
        target = str(target_name or "").strip()
        if not target:
            return []
        if scope_type == ROLE_REQUEST_TYPE_ALLIANCE:
            rows = connection.execute(
                """
                SELECT DISTINCT guild
                FROM guild_registry
                WHERE (hill = ? OR alliance = ?) AND guild IS NOT NULL AND guild != ''
                ORDER BY guild COLLATE NOCASE ASC
                """,
                (target, target),
            ).fetchall()
            return [row["guild"] for row in rows]
        return [target]

    def scope_matches_user_league(self, connection, user, target_name):
        target = str(target_name or "").strip()
        if not target:
            return False
        scopes = set(split_league_scopes(user.get("league", "")))
        if not scopes:
            fallback_alliance = str(user.get("alliance") or "").strip()
            return bool(fallback_alliance) and fallback_alliance == target
        if target in scopes:
            return True
        guilds = self.get_guilds_for_league_scope(connection, ROLE_REQUEST_TYPE_ALLIANCE, target)
        return any(guild in scopes for guild in guilds)

    def sync_verified_member_flags(self, connection):
        connection.execute(
            """
            UPDATE members
            SET verified = 1
            WHERE id IN (
                SELECT DISTINCT member_id FROM users WHERE member_id IS NOT NULL AND role = ?
            )
            """,
            (ROLE_VERIFIEDUSER,),
        )
        connection.commit()

    def list_member_cert_requests(self, current, mine=False, member_id=None):
        user = current.get("user") or {}
        role = user.get("role") or ROLE_GUEST
        params = []
        clauses = ["r.status = 'pending'"]
        if mine:
            clauses.append("r.user_id = ?")
            params.append(user.get("id"))
        elif role != ROLE_SUPERADMIN:
            clauses.append("r.user_id = ?")
            params.append(user.get("id"))
        if member_id:
            clauses.append("r.member_id = ?")
            params.append(int(member_id))

        where_sql = " AND ".join(clauses)
        with open_db() as connection:
            rows = connection.execute(
                f"""
                SELECT r.*, u.username, u.email, u.role AS user_role, u.alliance AS user_alliance,
                       m.name AS member_name, m.guild AS guild_name, m.verified AS member_verified
                FROM member_cert_requests r
                LEFT JOIN users u ON u.id = r.user_id
                LEFT JOIN members m ON m.id = r.member_id
                WHERE {where_sql}
                ORDER BY r.id DESC
                """,
                tuple(params),
            ).fetchall()
            if role == ROLE_ALLIANCEADMIN and not mine:
                rows = [
                    row
                    for row in rows
                    if self.scope_matches_user_league(connection, user, row["guild_name"] or row["alliance"])
                ]
        return {
            "items": [
                {
                    "id": row["id"],
                    "user_id": row["user_id"],
                    "member_id": row["member_id"],
                    "alliance": row["alliance"],
                    "status": row["status"],
                    "created_at": row["created_at"],
                    "reviewed_at": row["reviewed_at"],
                    "reviewer_id": row["reviewer_id"],
                    "username": row["username"],
                    "email": row["email"],
                    "display_name": row["username"],
                    "member_name": row["member_name"],
                    "guild_name": row["guild_name"],
                    "member_verified": row["member_verified"],
                }
                for row in rows
            ]
        }

    def create_member_cert_request(self, current, payload):
        user = current.get("user") or {}
        member_id = str(payload.get("member_id", "")).strip()
        if not member_id.isdigit():
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        with open_db() as connection:
            member = connection.execute("SELECT * FROM members WHERE id = ?", (member_id,)).fetchone()
            if not member:
                self.send_json({"error": "成员不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            if int(member["verified"] or 0) == 1:
                self.send_json({"error": "该成员已经认证"}, status=HTTPStatus.CONFLICT)
                return
            exists = connection.execute(
                """
                SELECT id FROM member_cert_requests
                WHERE user_id = ? AND member_id = ? AND status = 'pending'
                """,
                (user.get("id"), member_id),
            ).fetchone()
            if exists:
                self.send_json({"error": "你已经提交过该成员的认证申请"}, status=HTTPStatus.CONFLICT)
                return
            timestamp = now_text()
            connection.execute(
                """
                INSERT INTO member_cert_requests (user_id, member_id, alliance, status, created_at)
                VALUES (?, ?, ?, 'pending', ?)
                """,
                (user.get("id"), member_id, member["alliance"], timestamp),
            )
            connection.commit()
        self.send_json({"message": "认证申请已提交"}, status=HTTPStatus.CREATED)

    def review_member_cert_request(self, request_id, payload, current):
        action = str(payload.get("action", "")).strip().lower()
        if action not in {"approve", "reject"}:
            self.send_json({"error": "操作无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        if not str(request_id).isdigit():
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        user = current.get("user") or {}
        with open_db() as connection:
            row = connection.execute(
                """
                SELECT r.*, u.username, u.role AS user_role, u.alliance AS user_alliance, m.verified AS member_verified
                FROM member_cert_requests r
                LEFT JOIN users u ON u.id = r.user_id
                LEFT JOIN members m ON m.id = r.member_id
                WHERE r.id = ?
                """,
                (request_id,),
            ).fetchone()
            if not row:
                self.send_json({"error": "申请不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            if current.get("user", {}).get("role") == ROLE_ALLIANCEADMIN and row["alliance"] != user.get("alliance", ""):
                self.send_json({"error": "只能审核本联盟的认证申请"}, status=HTTPStatus.FORBIDDEN)
                return
            if action == "approve":
                if int(row["member_verified"] or 0) == 1:
                    self.send_json({"error": "该成员已经认证"}, status=HTTPStatus.CONFLICT)
                    return
                timestamp = now_text()
                connection.execute(
                    "UPDATE members SET verified = 1, updated_at = ? WHERE id = ?",
                    (timestamp, row["member_id"]),
                )
                connection.execute(
                    """
                    UPDATE users
                    SET member_id = ?, member = ?, role = ?, alliance = ?
                    WHERE id = ?
                    """,
                    (row["member_id"], row["member_id"], ROLE_VERIFIEDUSER, row["alliance"], row["user_id"]),
                )
                update_user_sessions_for_user(
                    row["user_id"],
                    member_id=row["member_id"],
                    member=row["member_id"],
                    role=ROLE_VERIFIEDUSER,
                    alliance=row["alliance"],
                )
                connection.execute(
                    """
                    UPDATE member_cert_requests
                    SET status = 'approved', reviewed_at = ?, reviewer_id = ?
                    WHERE id = ?
                    """,
                    (timestamp, user.get("id"), request_id),
                )
                connection.commit()
                self.send_json({"message": "认证申请已通过"})
                return
            timestamp = now_text()
            connection.execute(
                """
                UPDATE member_cert_requests
                SET status = 'rejected', reviewed_at = ?, reviewer_id = ?
                WHERE id = ?
                """,
                (timestamp, user.get("id"), request_id),
            )
            connection.commit()
        self.send_json({"message": "认证申请已拒绝"})

    def review_member_cert_request(self, request_id, payload, current):
        action = str(payload.get("action", "")).strip().lower()
        if action not in {"approve", "reject"}:
            self.send_json({"error": "操作无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        if not str(request_id).isdigit():
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        user = current.get("user") or {}
        with open_db() as connection:
            row = connection.execute(
                """
                SELECT r.*, u.username, u.role AS user_role, u.alliance AS user_alliance, m.verified AS member_verified
                FROM member_cert_requests r
                LEFT JOIN users u ON u.id = r.user_id
                LEFT JOIN members m ON m.id = r.member_id
                WHERE r.id = ?
                """,
                (request_id,),
            ).fetchone()
            if not row:
                self.send_json({"error": "申请不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            if current.get("user", {}).get("role") == ROLE_ALLIANCEADMIN:
                member_scope = connection.execute(
                    "SELECT guild, hill, alliance FROM members WHERE id = ?",
                    (row["member_id"],),
                ).fetchone()
                scope_name = ""
                if member_scope:
                    scope_name = member_scope["guild"] or member_scope["hill"] or member_scope["alliance"]
                if not self.scope_matches_user_league(connection, user, scope_name):
                    self.send_json({"error": "只能审核自己管理范围内的认证申请"}, status=HTTPStatus.FORBIDDEN)
                    return
            if action == "approve":
                if int(row["member_verified"] or 0) == 1:
                    self.send_json({"error": "该成员已经认证"}, status=HTTPStatus.CONFLICT)
                    return
                timestamp = now_text()
                connection.execute(
                    "UPDATE members SET verified = 1, updated_at = ? WHERE id = ?",
                    (timestamp, row["member_id"]),
                )
                connection.execute(
                    """
                    UPDATE users
                    SET member_id = ?, member = ?, role = ?, alliance = ?
                    WHERE id = ?
                    """,
                    (row["member_id"], row["member_id"], ROLE_VERIFIEDUSER, row["alliance"], row["user_id"]),
                )
                update_user_sessions_for_user(
                    row["user_id"],
                    member_id=row["member_id"],
                    member=row["member_id"],
                    role=ROLE_VERIFIEDUSER,
                    alliance=row["alliance"],
                )
                connection.execute(
                    """
                    UPDATE member_cert_requests
                    SET status = 'approved', reviewed_at = ?, reviewer_id = ?
                    WHERE id = ?
                    """,
                    (timestamp, user.get("id"), request_id),
                )
                connection.commit()
                self.send_json({"message": "认证申请已通过"})
                return
            timestamp = now_text()
            connection.execute(
                """
                UPDATE member_cert_requests
                SET status = 'rejected', reviewed_at = ?, reviewer_id = ?
                WHERE id = ?
                """,
                (timestamp, user.get("id"), request_id),
            )
            connection.commit()
        self.send_json({"message": "认证申请已拒绝"})

    def list_admin_role_requests(self, mark_read=False):
        with open_db() as connection:
            unread_count = connection.execute(
                "SELECT COUNT(*) AS count FROM admin_role_requests WHERE status = 'pending' AND is_read = 0"
            ).fetchone()["count"]
            if mark_read and unread_count:
                connection.execute(
                    """
                    UPDATE admin_role_requests
                    SET is_read = 1, read_at = ?
                    WHERE status = 'pending' AND is_read = 0
                    """,
                    (now_text(),),
                )
                connection.commit()
            rows = connection.execute(
                """
                SELECT r.*, u.username, u.email, u.role AS current_role
                FROM admin_role_requests r
                LEFT JOIN users u ON u.id = r.user_id
                WHERE r.status = 'pending'
                ORDER BY r.id DESC
                """
            ).fetchall()
        return {
            "items": [
                {
                    "id": row["id"],
                    "user_id": row["user_id"],
                    "username": row["username"],
                    "email": row["email"],
                    "current_role": row["current_role"],
                    "request_type": row["request_type"] or ROLE_REQUEST_TYPE_GUILD,
                    "alliance": row["alliance"],
                    "target_name": row["alliance"],
                    "status": row["status"],
                    "is_read": int(row["is_read"] or 0),
                    "created_at": row["created_at"],
                }
                for row in rows
            ],
            "unread_count": 0 if mark_read else unread_count,
        }

    def create_admin_role_request(self, current, payload):
        user = current.get("user") or {}
        alliance = str(payload.get("alliance", "")).strip()
        if not alliance:
            self.send_json({"error": "请选择联盟"}, status=HTTPStatus.BAD_REQUEST)
            return
        with open_db() as connection:
            known_alliances = set(self.get_known_alliances(connection))
            if alliance not in known_alliances:
                self.send_json({"error": "联盟不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            row = connection.execute("SELECT role, alliance FROM users WHERE id = ?", (user.get("id"),)).fetchone()
            if not row:
                self.send_json({"error": "用户不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            if row["role"] in {ROLE_ALLIANCEADMIN, ROLE_SUPERADMIN}:
                self.send_json({"error": "当前角色无需再次申请"}, status=HTTPStatus.CONFLICT)
                return
            exists = connection.execute(
                """
                SELECT id FROM admin_role_requests
                WHERE user_id = ? AND status = 'pending'
                """,
                (user.get("id"),),
            ).fetchone()
            if exists:
                self.send_json({"error": "你已经有待审核的申请"}, status=HTTPStatus.CONFLICT)
                return
            timestamp = now_text()
            connection.execute(
                """
                INSERT INTO admin_role_requests (user_id, alliance, status, is_read, created_at)
                VALUES (?, ?, 'pending', 0, ?)
                """,
                (user.get("id"), alliance, timestamp),
            )
            connection.commit()
        self.send_json({"message": "联盟管理员申请已提交"}, status=HTTPStatus.CREATED)

    def review_admin_role_request(self, request_id, payload, current):
        action = str(payload.get("action", "")).strip().lower()
        if action not in {"approve", "reject"}:
            self.send_json({"error": "操作无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        if not str(request_id).isdigit():
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        with open_db() as connection:
            row = connection.execute(
                """
                SELECT r.*, u.username, u.role AS current_role
                FROM admin_role_requests r
                LEFT JOIN users u ON u.id = r.user_id
                WHERE r.id = ?
                """,
                (request_id,),
            ).fetchone()
            if not row:
                self.send_json({"error": "申请不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            if action == "approve":
                timestamp = now_text()
                connection.execute(
                    """
                    UPDATE users
                    SET role = ?, alliance = ?
                    WHERE id = ?
                    """,
                    (ROLE_ALLIANCEADMIN, row["alliance"], row["user_id"]),
                )
                update_user_sessions_for_user(
                    row["user_id"],
                    role=ROLE_ALLIANCEADMIN,
                    alliance=row["alliance"],
                    is_admin=False,
                )
                connection.execute(
                    """
                    UPDATE admin_role_requests
                    SET status = 'approved', reviewed_at = ?, reviewer_id = ?
                    WHERE id = ?
                    """,
                    (timestamp, current.get("user", {}).get("id"), request_id),
                )
                connection.commit()
                self.send_json({"message": "联盟管理员申请已通过"})
                return
            timestamp = now_text()
            connection.execute(
                """
                UPDATE admin_role_requests
                SET status = 'rejected', reviewed_at = ?, reviewer_id = ?
                WHERE id = ?
                """,
                (timestamp, current.get("user", {}).get("id"), request_id),
            )
            connection.commit()
        self.send_json({"message": "联盟管理员申请已拒绝"})

    def create_admin_role_request(self, current, payload):
        user = current.get("user") or {}
        request_type = str(payload.get("request_type", ROLE_REQUEST_TYPE_GUILD)).strip().lower()
        target_name = str(payload.get("target_name", payload.get("alliance", ""))).strip()
        if request_type not in {ROLE_REQUEST_TYPE_GUILD, ROLE_REQUEST_TYPE_ALLIANCE}:
            self.send_json({"error": "申请类型无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        if not target_name:
            self.send_json({"error": "请选择目标"}, status=HTTPStatus.BAD_REQUEST)
            return

        with open_db() as connection:
            known_targets = (
                set(self.get_known_guilds(connection))
                if request_type == ROLE_REQUEST_TYPE_GUILD
                else set(self.get_known_alliances(connection))
            )
            if target_name not in known_targets:
                self.send_json({"error": "目标不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            row = connection.execute("SELECT role, alliance, league FROM users WHERE id = ?", (user.get("id"),)).fetchone()
            if not row:
                self.send_json({"error": "用户不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            if row["role"] in {ROLE_ALLIANCEADMIN, ROLE_SUPERADMIN}:
                self.send_json({"error": "当前角色无需再次申请"}, status=HTTPStatus.CONFLICT)
                return
            exists = connection.execute(
                """
                SELECT id FROM admin_role_requests
                WHERE user_id = ? AND status = 'pending'
                """,
                (user.get("id"),),
            ).fetchone()
            if exists:
                self.send_json({"error": "你已经有待审核的申请"}, status=HTTPStatus.CONFLICT)
                return
            timestamp = now_text()
            connection.execute(
                """
                INSERT INTO admin_role_requests (user_id, alliance, request_type, status, is_read, created_at)
                VALUES (?, ?, ?, 'pending', 0, ?)
                """,
                (user.get("id"), target_name, request_type, timestamp),
            )
            connection.commit()

        label = "妖盟盟主" if request_type == ROLE_REQUEST_TYPE_GUILD else "联盟盟主"
        self.send_json({"message": f"{label}申请已提交"}, status=HTTPStatus.CREATED)

    def review_admin_role_request(self, request_id, payload, current):
        action = str(payload.get("action", "")).strip().lower()
        if action not in {"approve", "reject"}:
            self.send_json({"error": "操作无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        if not str(request_id).isdigit():
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return

        with open_db() as connection:
            row = connection.execute(
                """
                SELECT r.*, u.username, u.role AS current_role
                FROM admin_role_requests r
                LEFT JOIN users u ON u.id = r.user_id
                WHERE r.id = ?
                """,
                (request_id,),
            ).fetchone()
            if not row:
                self.send_json({"error": "申请不存在"}, status=HTTPStatus.NOT_FOUND)
                return

            if action == "approve":
                timestamp = now_text()
                request_type = row["request_type"] or ROLE_REQUEST_TYPE_GUILD
                managed_guilds = self.get_guilds_for_league_scope(connection, request_type, row["alliance"])
                if not managed_guilds:
                    self.send_json({"error": "申请对应的管理范围不存在"}, status=HTTPStatus.BAD_REQUEST)
                    return
                league_value = join_league_scopes(managed_guilds)
                connection.execute(
                    """
                    UPDATE users
                    SET role = ?, alliance = ?, league = ?
                    WHERE id = ?
                    """,
                    (ROLE_ALLIANCEADMIN, row["alliance"], league_value, row["user_id"]),
                )
                update_user_sessions_for_user(
                    row["user_id"],
                    role=ROLE_ALLIANCEADMIN,
                    alliance=row["alliance"],
                    league=league_value,
                    is_admin=False,
                )
                connection.execute(
                    """
                    UPDATE admin_role_requests
                    SET status = 'approved', reviewed_at = ?, reviewer_id = ?
                    WHERE id = ?
                    """,
                    (timestamp, current.get("user", {}).get("id"), request_id),
                )
                connection.commit()
                self.send_json({"message": "管理角色申请已通过"})
                return

            timestamp = now_text()
            connection.execute(
                """
                UPDATE admin_role_requests
                SET status = 'rejected', reviewed_at = ?, reviewer_id = ?
                WHERE id = ?
                """,
                (timestamp, current.get("user", {}).get("id"), request_id),
            )
            connection.commit()
        self.send_json({"message": "管理角色申请已拒绝"})
