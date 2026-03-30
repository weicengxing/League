from alliance_server.shared import *
from datetime import datetime, timedelta

from auth import (
    ROLE_ALLIANCEADMIN,
    ROLE_GUEST,
    ROLE_SUPERADMIN,
    ROLE_VERIFIEDUSER,
    normalize_league_scope,
    normalize_role,
    update_user_sessions_for_user,
)

class ReviewRequestsMixin:
    MEMBER_UNBIND_COOLDOWN_DAYS = 7
    ADMIN_ROLE_REQUEST_RETENTION_DAYS = 5
    MEMBER_CERT_REQUEST_RETENTION_DAYS = 5
    IDENTITY_SWAP_REQUEST_RETENTION_DAYS = 7

    def _parse_db_datetime(self, value):
        text = str(value or "").strip()
        if not text:
            return None
        try:
            return datetime.strptime(text, "%Y-%m-%d %H:%M:%S")
        except ValueError:
            return None

    def get_member_unbind_cooldown_error(self, user):
        available_at = self._parse_db_datetime(user.get("member_unbind_available_at"))
        if not available_at:
            return None
        if datetime.now() >= available_at:
            return None
        return f"解绑后需等待 7 天才能再次认领成员身份，请于 {available_at.strftime('%Y-%m-%d %H:%M:%S')} 后再试"

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
            SELECT DISTINCT guild_key
            FROM guild_registry
            WHERE guild_key IS NOT NULL AND guild_key != ''
            ORDER BY guild_key COLLATE NOCASE ASC
            """
        ).fetchall()
        return [row["guild_key"] for row in rows]

    def get_guilds_for_league_scope(self, connection, request_type, target_name):
        scope_type = str(request_type or ROLE_REQUEST_TYPE_GUILD).strip().lower()
        target = str(target_name or "").strip()
        if not target:
            return []
        if scope_type == ROLE_REQUEST_TYPE_ALLIANCE:
            rows = connection.execute(
                """
                SELECT DISTINCT guild_key
                FROM guild_registry
                WHERE (hill = ? OR alliance = ?) AND guild_key IS NOT NULL AND guild_key != ''
                ORDER BY guild_key COLLATE NOCASE ASC
                """,
                (target, target),
            ).fetchall()
            return [row["guild_key"] for row in rows]
        rows = connection.execute(
            """
            SELECT DISTINCT guild_key
            FROM guild_registry
            WHERE (guild_key = ? OR guild_prefix = ? OR guild = ?) AND guild_key IS NOT NULL AND guild_key != ''
            ORDER BY guild_key COLLATE NOCASE ASC
            """,
            (target, target, target),
        ).fetchall()
        return [row["guild_key"] for row in rows] or [target]

    def get_scope_aliases(self, connection, target_name):
        target = str(target_name or "").strip()
        if not target:
            return set()
        aliases = {target}
        rows = connection.execute(
            """
            SELECT DISTINCT guild_key, guild_prefix, guild, hill, alliance
            FROM guild_registry
            WHERE guild_key = ? OR guild_prefix = ? OR guild = ? OR hill = ? OR alliance = ?
            """,
            (target, target, target, target, target),
        ).fetchall()
        for row in rows:
            aliases.update(
                value.strip()
                for value in [row["guild_key"], row["guild_prefix"], row["guild"], row["hill"], row["alliance"]]
                if str(value or "").strip()
            )
        return aliases

    def get_scope_alliance_name(self, connection, request_type, target_name):
        scope_type = str(request_type or ROLE_REQUEST_TYPE_GUILD).strip().lower()
        target = str(target_name or "").strip()
        if not target:
            return ""
        if scope_type == ROLE_REQUEST_TYPE_ALLIANCE:
            return target
        row = connection.execute(
            """
            SELECT hill, alliance
            FROM guild_registry
            WHERE guild_key = ? OR guild_prefix = ? OR guild = ?
            ORDER BY updated_at DESC, guild_key ASC, guild_prefix ASC, guild ASC
            LIMIT 1
            """,
            (target, target, target),
        ).fetchone()
        if not row:
            return target
        return str(row["hill"] or row["alliance"] or target).strip()

    def scope_matches_user_league(self, connection, user, target_name):
        target = str(target_name or "").strip()
        if not target:
            return False
        aliases = self.get_scope_aliases(connection, target)
        if hasattr(user, "keys"):
            league_value = user["league"] if "league" in user.keys() else ""
            alliance_value = user["alliance"] if "alliance" in user.keys() else ""
        else:
            league_value = user.get("league", "")
            alliance_value = user.get("alliance", "")
        scopes = set(split_league_scopes(league_value))
        if not scopes:
            fallback_alliance = str(alliance_value or "").strip()
            return bool(fallback_alliance) and fallback_alliance in aliases
        if scopes.intersection(aliases):
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

    def cleanup_expired_admin_role_requests(self, connection):
        cutoff = (datetime.now() - timedelta(days=self.ADMIN_ROLE_REQUEST_RETENTION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
        connection.execute(
            """
            DELETE FROM admin_role_requests
            WHERE created_at <= ?
            """,
            (cutoff,),
        )
        connection.commit()

    def cleanup_expired_member_cert_requests(self, connection):
        cutoff = (datetime.now() - timedelta(days=self.MEMBER_CERT_REQUEST_RETENTION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
        connection.execute(
            """
            DELETE FROM member_cert_requests
            WHERE created_at <= ?
            """,
            (cutoff,),
        )
        connection.commit()

    def cleanup_expired_identity_swap_requests(self, connection):
        cutoff = (datetime.now() - timedelta(days=self.IDENTITY_SWAP_REQUEST_RETENTION_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
        connection.execute(
            """
            DELETE FROM identity_swap_requests
            WHERE created_at <= ?
            """,
            (cutoff,),
        )
        connection.commit()

    def _build_identity_swap_identity(self, row):
        return {
            "role": normalize_role(row["role"]),
            "league": normalize_league_scope(row["league"]),
            "member_id": row["member_id"],
            "member": row["member"],
            "alliance": str(row["alliance"] or "").strip(),
            "member_unbind_available_at": row["member_unbind_available_at"],
        }

    def execute_identity_swap(self, connection, user_a_row, user_b_row):
        identity_a = self._build_identity_swap_identity(user_a_row)
        identity_b = self._build_identity_swap_identity(user_b_row)

        connection.execute(
            """
            UPDATE users
            SET role = ?,
                league = ?,
                member_id = ?,
                member = ?,
                alliance = ?,
                member_unbind_available_at = ?
            WHERE id = ?
            """,
            (
                identity_b["role"],
                identity_b["league"],
                identity_b["member_id"],
                identity_b["member"],
                identity_b["alliance"],
                identity_b["member_unbind_available_at"],
                int(user_a_row["id"]),
            ),
        )
        connection.execute(
            """
            UPDATE users
            SET role = ?,
                league = ?,
                member_id = ?,
                member = ?,
                alliance = ?,
                member_unbind_available_at = ?
            WHERE id = ?
            """,
            (
                identity_a["role"],
                identity_a["league"],
                identity_a["member_id"],
                identity_a["member"],
                identity_a["alliance"],
                identity_a["member_unbind_available_at"],
                int(user_b_row["id"]),
            ),
        )
        return identity_a, identity_b

    def get_member_cert_scope_name(self, member_row):
        if not member_row:
            return ""
        return str(member_row["guild"] or member_row["hill"] or member_row["alliance"] or "").strip()

    def get_member_cert_reviewer_ids(self, connection, member_row):
        reviewer_ids = set()
        scope_name = self.get_member_cert_scope_name(member_row)
        rows = connection.execute(
            """
            SELECT id, role, alliance, league
            FROM users
            WHERE role IN (?, ?)
            """,
            (ROLE_ALLIANCEADMIN, ROLE_SUPERADMIN),
        ).fetchall()
        for row in rows:
            if row["role"] == ROLE_SUPERADMIN:
                reviewer_ids.add(int(row["id"]))
                continue
            if scope_name and self.scope_matches_user_league(connection, row, scope_name):
                reviewer_ids.add(int(row["id"]))
        return reviewer_ids

    def list_member_cert_requests(self, current, mine=False, member_id=None, mark_read=False):
        user = current.get("user") or {}
        role = user.get("role") or ROLE_GUEST
        is_reviewer = bool(current.get("is_admin")) or role in {ROLE_SUPERADMIN, ROLE_ALLIANCEADMIN}
        params = []
        unread_ids = []
        if mine or not is_reviewer:
            clauses = []
            clauses.append("r.user_id = ?")
            params.append(user.get("id"))
        else:
            clauses = ["r.status = 'pending'"]
        if member_id:
            clauses.append("r.member_id = ?")
            params.append(int(member_id))

        where_sql = " AND ".join(clauses)
        with open_db() as connection:
            self.cleanup_expired_member_cert_requests(connection)
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
            if role == ROLE_ALLIANCEADMIN and is_reviewer and not mine:
                rows = [
                    row
                    for row in rows
                    if self.scope_matches_user_league(connection, user, row["guild_name"] or row["alliance"])
                ]
            if is_reviewer and not mine:
                unread_ids = [int(row["id"]) for row in rows if row["status"] == "pending" and int(row["is_read"] or 0) == 0]
                if mark_read and unread_ids:
                    placeholders = ",".join("?" for _ in unread_ids)
                    connection.execute(
                        f"""
                        UPDATE member_cert_requests
                        SET is_read = 1, read_at = ?
                        WHERE id IN ({placeholders}) AND status = 'pending' AND is_read = 0
                        """,
                        (now_text(), *unread_ids),
                    )
                    connection.commit()
            else:
                unread_ids = [int(row["id"]) for row in rows if row["status"] != "pending" and int(row["is_read"] or 0) == 0]
                if mark_read and unread_ids:
                    placeholders = ",".join("?" for _ in unread_ids)
                    connection.execute(
                        f"""
                        UPDATE member_cert_requests
                        SET is_read = 1, read_at = ?
                        WHERE id IN ({placeholders}) AND status != 'pending' AND is_read = 0
                        """,
                        (now_text(), *unread_ids),
                    )
                    connection.commit()
        return {
            "items": [
                {
                    "id": row["id"],
                    "user_id": row["user_id"],
                    "member_id": row["member_id"],
                    "alliance": row["alliance"],
                    "status": row["status"],
                    "is_read": int(row["is_read"] or 0),
                    "created_at": row["created_at"],
                    "read_at": row["read_at"],
                    "reviewed_at": row["reviewed_at"],
                    "reviewer_id": row["reviewer_id"],
                    "review_comment": row["review_comment"] or "",
                    "username": row["username"],
                    "email": row["email"],
                    "display_name": row["username"],
                    "member_name": row["member_name"],
                    "guild_name": row["guild_name"],
                    "member_verified": row["member_verified"],
                }
                for row in rows
            ],
            "unread_count": 0 if mark_read else len(unread_ids),
        }

    def create_member_cert_request(self, current, payload):
        user = current.get("user") or {}
        member_id = str(payload.get("member_id", "")).strip()
        if not member_id.isdigit():
            self.send_json({"error": "鍙傛暟鏃犳晥"}, status=HTTPStatus.BAD_REQUEST)
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
                self.send_json({"error": "浣犲凡缁忔彁浜よ繃璇ユ垚鍛樼殑璁よ瘉鐢宠"}, status=HTTPStatus.CONFLICT)
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
        review_comment = str(payload.get("review_comment", payload.get("comment", ""))).strip()
        if action not in {"approve", "reject"}:
            self.send_json({"error": "鎿嶄綔鏃犳晥"}, status=HTTPStatus.BAD_REQUEST)
            return
        if not str(request_id).isdigit():
            self.send_json({"error": "鍙傛暟鏃犳晥"}, status=HTTPStatus.BAD_REQUEST)
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
                self.send_json({"error": "鍙兘瀹℃牳鏈仈鐩熺殑璁よ瘉鐢宠"}, status=HTTPStatus.FORBIDDEN)
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
                    SET member_id = ?, member = ?, role = ?, alliance = ?, member_unbind_available_at = NULL
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
                    member_unbind_available_at=None,
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
                self.send_json({"message": "璁よ瘉鐢宠宸查€氳繃"})
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
        review_comment = str(payload.get("review_comment", payload.get("comment", ""))).strip()
        if action not in {"approve", "reject"}:
            self.send_json({"error": "鎿嶄綔鏃犳晥"}, status=HTTPStatus.BAD_REQUEST)
            return
        if not str(request_id).isdigit():
            self.send_json({"error": "鍙傛暟鏃犳晥"}, status=HTTPStatus.BAD_REQUEST)
            return
        user = current.get("user") or {}
        reviewer_name = user.get("display_name") or user.get("username") or "管理员"
        with member_cert_request_review_lock:
            with open_db() as connection:
                self.cleanup_expired_member_cert_requests(connection)
                connection.execute("BEGIN IMMEDIATE")
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
                    connection.rollback()
                    self.send_json({"error": "申请不存在"}, status=HTTPStatus.NOT_FOUND)
                    return
                if row["status"] != "pending":
                    connection.rollback()
                    status_label = "已通过" if row["status"] == "approved" else "已拒绝"
                    self.send_json(
                        {
                            "error": f"该申请已处理过（{status_label}）",
                            "status": row["status"],
                            "reviewed_at": row["reviewed_at"],
                            "reviewer_id": row["reviewer_id"],
                            "review_comment": row["review_comment"] or "",
                        },
                        status=HTTPStatus.CONFLICT,
                    )
                    return
                if current.get("user", {}).get("role") == ROLE_ALLIANCEADMIN:
                    member_scope = connection.execute(
                        "SELECT guild, hill, alliance FROM members WHERE id = ?",
                        (row["member_id"],),
                    ).fetchone()
                    if not self.scope_matches_user_league(connection, user, self.get_member_cert_scope_name(member_scope)):
                        connection.rollback()
                        self.send_json({"error": "鍙兘瀹℃牳鑷繁绠＄悊鑼冨洿鍐呯殑璁よ瘉鐢宠"}, status=HTTPStatus.FORBIDDEN)
                        return
                timestamp = now_text()
                if action == "approve":
                    if int(row["member_verified"] or 0) == 1:
                        connection.rollback()
                        self.send_json({"error": "该成员已经认证"}, status=HTTPStatus.CONFLICT)
                        return
                    connection.execute(
                        "UPDATE members SET verified = 1, updated_at = ? WHERE id = ?",
                        (timestamp, row["member_id"]),
                    )
                    connection.execute(
                        """
                        UPDATE users
                        SET member_id = ?, member = ?, role = ?, alliance = ?, member_unbind_available_at = NULL
                        WHERE id = ?
                        """,
                        (row["member_id"], row["member_id"], ROLE_VERIFIEDUSER, row["alliance"], row["user_id"]),
                    )
                    updated = connection.execute(
                        """
                        UPDATE member_cert_requests
                        SET status = 'approved', reviewed_at = ?, reviewer_id = ?, review_comment = ?, is_read = 0, read_at = NULL
                        WHERE id = ? AND status = 'pending'
                        """,
                        (timestamp, user.get("id"), review_comment, request_id),
                    )
                    if updated.rowcount != 1:
                        connection.rollback()
                        self.send_json({"error": "该申请已处理过"}, status=HTTPStatus.CONFLICT)
                        return
                    connection.commit()
                    update_user_sessions_for_user(
                        row["user_id"],
                        member_id=row["member_id"],
                        member=row["member_id"],
                        role=ROLE_VERIFIEDUSER,
                        alliance=row["alliance"],
                        member_unbind_available_at=None,
                    )
                    member_scope = connection.execute(
                        "SELECT guild, hill, alliance FROM members WHERE id = ?",
                        (row["member_id"],),
                    ).fetchone()
                    reviewer_ids = self.get_member_cert_reviewer_ids(connection, member_scope)
                    broadcast_auth_event(
                        {
                            "type": "member_cert_request_reviewed",
                            "request_id": int(request_id),
                            "member_id": int(row["member_id"]),
                            "status": "approved",
                            "reviewed_by": reviewer_name,
                            "review_comment": review_comment,
                        },
                        lambda session: bool(session.get("is_admin"))
                        or int(session.get("user_id") or 0) in reviewer_ids
                        or int(session.get("user_id") or 0) == int(row["user_id"] or 0),
                    )
                    self.send_json({"message": "璁よ瘉鐢宠宸查€氳繃"})
                    return
                updated = connection.execute(
                    """
                    UPDATE member_cert_requests
                    SET status = 'rejected', reviewed_at = ?, reviewer_id = ?, review_comment = ?, is_read = 0, read_at = NULL
                    WHERE id = ? AND status = 'pending'
                    """,
                    (timestamp, user.get("id"), review_comment, request_id),
                )
                if updated.rowcount != 1:
                    connection.rollback()
                    self.send_json({"error": "该申请已处理过"}, status=HTTPStatus.CONFLICT)
                    return
                connection.commit()
                member_scope = connection.execute(
                    "SELECT guild, hill, alliance FROM members WHERE id = ?",
                    (row["member_id"],),
                ).fetchone()
                reviewer_ids = self.get_member_cert_reviewer_ids(connection, member_scope)
                broadcast_auth_event(
                    {
                        "type": "member_cert_request_reviewed",
                        "request_id": int(request_id),
                        "member_id": int(row["member_id"]),
                        "status": "rejected",
                        "reviewed_by": reviewer_name,
                        "review_comment": review_comment,
                    },
                    lambda session: bool(session.get("is_admin"))
                    or int(session.get("user_id") or 0) in reviewer_ids
                    or int(session.get("user_id") or 0) == int(row["user_id"] or 0),
                )
        self.send_json({"message": "认证申请已拒绝"})

    def create_member_cert_request(self, current, payload):
        user = current.get("user") or {}
        member_id = str(payload.get("member_id", "")).strip()
        if not member_id.isdigit():
            self.send_json({"error": "鍙傛暟鏃犳晥"}, status=HTTPStatus.BAD_REQUEST)
            return
        cooldown_error = self.get_member_unbind_cooldown_error(user)
        if cooldown_error:
            self.send_json({"error": cooldown_error}, status=HTTPStatus.FORBIDDEN)
            return
        with open_db() as connection:
            self.cleanup_expired_member_cert_requests(connection)
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
                self.send_json({"error": "浣犲凡缁忔彁浜よ繃璇ユ垚鍛樼殑璁よ瘉鐢宠"}, status=HTTPStatus.CONFLICT)
                return
            timestamp = now_text()
            connection.execute(
                """
                INSERT INTO member_cert_requests (user_id, member_id, alliance, status, review_comment, is_read, created_at)
                VALUES (?, ?, ?, 'pending', '', 0, ?)
                """,
                (user.get("id"), member_id, member["alliance"], timestamp),
            )
            request_id = int(connection.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            reviewer_ids = self.get_member_cert_reviewer_ids(connection, member)
            connection.commit()
        broadcast_auth_event(
            {
                "type": "member_cert_request_created",
                "request_id": request_id,
                "member_id": int(member_id),
                "member_name": member["name"] or "",
                "guild_name": member["guild"] or "",
                "alliance": member["alliance"] or "",
                "username": user.get("display_name") or user.get("username") or "",
            },
            lambda session: bool(session.get("is_admin")) or int(session.get("user_id") or 0) in reviewer_ids,
        )
        self.send_json({"message": "认证申请已提交"}, status=HTTPStatus.CREATED)

    def unlink_current_user_member(self, current):
        user = current.get("user") or {}
        if not user.get("id"):
            self.send_json({"error": "璇峰厛鐧诲綍"}, status=HTTPStatus.UNAUTHORIZED)
            return
        member_id = user.get("member_id") or user.get("member")
        if not member_id:
            self.send_json({"error": "褰撳墠璐﹀彿杩樻湭鍏宠仈濡栫洘鎴愬憳韬唤"}, status=HTTPStatus.BAD_REQUEST)
            return

        current_role = user.get("role") or ROLE_GUEST
        keep_role = current_role == ROLE_ALLIANCEADMIN
        next_role = current_role if keep_role else ROLE_GUEST
        next_alliance = user.get("alliance", "") if keep_role else ""
        timestamp = now_text()
        available_at = None if keep_role else (datetime.now() + timedelta(days=self.MEMBER_UNBIND_COOLDOWN_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
        with open_db() as connection:
            db_user = connection.execute(
                """
                SELECT id, member_id, member, alliance
                FROM users
                WHERE id = ?
                """,
                (user["id"],),
            ).fetchone()
            if not db_user:
                self.send_json({"error": "用户不存在"}, status=HTTPStatus.NOT_FOUND)
                return

            linked_member_id = db_user["member_id"] or db_user["member"]
            if not linked_member_id:
                self.send_json({"error": "褰撳墠璐﹀彿杩樻湭鍏宠仈濡栫洘鎴愬憳韬唤"}, status=HTTPStatus.BAD_REQUEST)
                return

            connection.execute(
                "UPDATE members SET verified = 0, updated_at = ? WHERE id = ?",
                (timestamp, linked_member_id),
            )
            connection.execute(
                """
                UPDATE users
                SET member_id = NULL,
                    member = NULL,
                    role = ?,
                    alliance = ?,
                    member_unbind_available_at = ?
                WHERE id = ?
                """,
                (next_role, next_alliance, available_at, user["id"]),
            )
            connection.commit()

        update_user_sessions_for_user(
            user["id"],
            member_id=None,
            member=None,
            role=next_role,
            alliance=next_alliance,
            member_unbind_available_at=available_at,
        )
        self.send_json(
            {
                "message": "已解绑妖盟成员身份",
                "unbind_available_at": available_at,
            }
        )

    def link_current_user_member(self, current, payload):
        user = current.get("user") or {}
        if not user.get("id"):
            self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
            return
        if (user.get("role") or "") != ROLE_ALLIANCEADMIN:
            self.send_json({"error": "当前账号不是盟主，不能直接成为成员"}, status=HTTPStatus.FORBIDDEN)
            return

        member_id = str(payload.get("member_id", "")).strip()
        force = bool(payload.get("force"))
        if not member_id.isdigit():
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return

        with open_db() as connection:
            member = connection.execute("SELECT id, alliance, guild, name, verified FROM members WHERE id = ?", (int(member_id),)).fetchone()
            if not member:
                self.send_json({"error": "成员不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            if int(member["verified"] or 0) == 1:
                self.send_json({"error": "该成员已经认证，不可成为"}, status=HTTPStatus.CONFLICT)
                return

            db_user = connection.execute(
                "SELECT id, role, member_id, member, alliance FROM users WHERE id = ?",
                (user["id"],),
            ).fetchone()
            if not db_user:
                self.send_json({"error": "用户不存在"}, status=HTTPStatus.NOT_FOUND)
                return

            previous_member_id = db_user["member_id"] or db_user["member"]
            if previous_member_id and str(previous_member_id) != member_id and not force:
                self.send_json(
                    {
                        "error": "你已有身份，是否强行修改",
                        "code": "MEMBER_ALREADY_LINKED",
                        "current_member_id": int(previous_member_id),
                    },
                    status=HTTPStatus.CONFLICT,
                )
                return

            timestamp = now_text()
            if previous_member_id and str(previous_member_id) != member_id:
                connection.execute(
                    "UPDATE members SET verified = 0, updated_at = ? WHERE id = ?",
                    (timestamp, int(previous_member_id)),
                )

            connection.execute(
                "UPDATE members SET verified = 1, updated_at = ? WHERE id = ?",
                (timestamp, int(member_id)),
            )
            connection.execute(
                """
                UPDATE users
                SET member_id = ?, member = ?, alliance = ?, member_unbind_available_at = NULL
                WHERE id = ?
                """,
                (int(member_id), int(member_id), member["alliance"], user["id"]),
            )
            connection.commit()

        update_user_sessions_for_user(
            user["id"],
            member_id=int(member_id),
            member=int(member_id),
            alliance=member["alliance"],
            member_unbind_available_at=None,
        )
        self.send_json(
            {
                "message": "已成为该成员身份",
                "item": {
                    "member_id": int(member_id),
                    "name": member["name"],
                    "guild": member["guild"],
                    "alliance": member["alliance"],
                },
            }
        )

    def list_identity_swap_requests(self, current, mark_read=False):
        user = current.get("user") or {}
        user_id = int(user.get("id") or 0)
        if not user_id:
            return {"items": [], "unread_count": 0}

        with open_db() as connection:
            self.cleanup_expired_identity_swap_requests(connection)
            rows = connection.execute(
                """
                SELECT r.*,
                       ru.username AS requester_username,
                       tu.username AS target_username,
                       rm.name AS requester_member_name,
                       rm.alliance AS requester_alliance,
                       rm.guild AS requester_guild,
                       tm.name AS target_member_name,
                       tm.alliance AS target_alliance,
                       tm.guild AS target_guild
                FROM identity_swap_requests r
                LEFT JOIN users ru ON ru.id = r.user_id
                LEFT JOIN users tu ON tu.id = r.target_user_id
                LEFT JOIN members rm ON rm.id = r.requester_member_id
                LEFT JOIN members tm ON tm.id = r.target_member_id
                WHERE r.user_id = ? OR r.target_user_id = ?
                ORDER BY r.id DESC
                """,
                (user_id, user_id),
            ).fetchall()

            unread_ids_for_target = [
                int(row["id"])
                for row in rows
                if int(row["target_user_id"] or 0) == user_id and row["status"] == "pending" and int(row["target_is_read"] or 0) == 0
            ]
            unread_ids_for_requester = [
                int(row["id"])
                for row in rows
                if int(row["user_id"] or 0) == user_id and row["status"] != "pending" and int(row["requester_is_read"] or 0) == 0
            ]

            if mark_read:
                timestamp = now_text()
                if unread_ids_for_target:
                    placeholders = ",".join("?" for _ in unread_ids_for_target)
                    connection.execute(
                        f"""
                        UPDATE identity_swap_requests
                        SET target_is_read = 1, target_read_at = ?
                        WHERE id IN ({placeholders})
                        """,
                        (timestamp, *unread_ids_for_target),
                    )
                if unread_ids_for_requester:
                    placeholders = ",".join("?" for _ in unread_ids_for_requester)
                    connection.execute(
                        f"""
                        UPDATE identity_swap_requests
                        SET requester_is_read = 1, requester_read_at = ?
                        WHERE id IN ({placeholders})
                        """,
                        (timestamp, *unread_ids_for_requester),
                    )
                if unread_ids_for_target or unread_ids_for_requester:
                    connection.commit()

        items = []
        for row in rows:
            is_outgoing = int(row["user_id"] or 0) == user_id
            items.append(
                {
                    "id": int(row["id"]),
                    "user_id": int(row["user_id"]),
                    "target_user_id": int(row["target_user_id"]),
                    "requester_member_id": int(row["requester_member_id"]),
                    "target_member_id": int(row["target_member_id"]),
                    "status": row["status"],
                    "message": row["message"] or "",
                    "review_comment": row["review_comment"] or "",
                    "created_at": row["created_at"],
                    "reviewed_at": row["reviewed_at"],
                    "reviewer_id": row["reviewer_id"],
                    "requester_username": row["requester_username"] or "",
                    "target_username": row["target_username"] or "",
                    "requester_member_name": row["requester_member_name"] or "",
                    "requester_alliance": row["requester_alliance"] or "",
                    "requester_guild": row["requester_guild"] or "",
                    "target_member_name": row["target_member_name"] or "",
                    "target_alliance": row["target_alliance"] or "",
                    "target_guild": row["target_guild"] or "",
                    "is_outgoing": is_outgoing,
                    "can_review": (not is_outgoing) and row["status"] == "pending",
                    "is_read": 1
                    if mark_read
                    else (
                        int(row["requester_is_read"] or 0)
                        if is_outgoing and row["status"] != "pending"
                        else int(row["target_is_read"] or 0)
                    ),
                }
            )

        return {
            "items": items,
            "unread_count": 0 if mark_read else len(unread_ids_for_target) + len(unread_ids_for_requester),
        }

    def create_identity_swap_request(self, current, payload):
        user = current.get("user") or {}
        current_user_id = int(user.get("id") or 0)
        target_member_id = str(payload.get("member_id", "")).strip()
        message = str(payload.get("message", payload.get("swap_message", ""))).strip()
        if not current_user_id:
            self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
            return
        if not target_member_id.isdigit():
            self.send_json({"error": "请选择要交换的认证成员"}, status=HTTPStatus.BAD_REQUEST)
            return

        with open_db() as connection:
            self.cleanup_expired_identity_swap_requests(connection)
            current_row = connection.execute(
                """
                SELECT id, username, role, league, member_id, member, alliance, member_unbind_available_at
                FROM users
                WHERE id = ?
                """,
                (current_user_id,),
            ).fetchone()
            if not current_row:
                self.send_json({"error": "当前用户不存在"}, status=HTTPStatus.NOT_FOUND)
                return

            current_member_id = current_row["member_id"] or current_row["member"]
            if not current_member_id:
                self.send_json({"error": "你还没有认证，暂时不能发起交换"}, status=HTTPStatus.BAD_REQUEST)
                return

            target_row = connection.execute(
                """
                SELECT id, username, role, league, member_id, member, alliance, member_unbind_available_at
                FROM users
                WHERE COALESCE(member_id, member) = ?
                LIMIT 1
                """,
                (int(target_member_id),),
            ).fetchone()
            if not target_row:
                self.send_json({"error": "目标成员当前没有绑定账号，不能交换"}, status=HTTPStatus.BAD_REQUEST)
                return
            if int(target_row["id"]) == current_user_id:
                self.send_json({"error": "不能向自己发起交换申请"}, status=HTTPStatus.BAD_REQUEST)
                return

            target_member_row = connection.execute(
                "SELECT id, name, alliance, guild, verified FROM members WHERE id = ?",
                (int(target_member_id),),
            ).fetchone()
            if not target_member_row:
                self.send_json({"error": "目标成员不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            if int(target_member_row["verified"] or 0) != 1:
                self.send_json({"error": "只能向已认证成员发起交换申请"}, status=HTTPStatus.BAD_REQUEST)
                return

            exists = connection.execute(
                """
                SELECT id FROM identity_swap_requests
                WHERE status = 'pending'
                  AND ((user_id = ? AND target_user_id = ?) OR (user_id = ? AND target_user_id = ?))
                LIMIT 1
                """,
                (current_user_id, int(target_row["id"]), int(target_row["id"]), current_user_id),
            ).fetchone()
            if exists:
                self.send_json({"error": "你们之间已经有待处理的交换申请"}, status=HTTPStatus.CONFLICT)
                return

            timestamp = now_text()
            connection.execute(
                """
                INSERT INTO identity_swap_requests (
                    user_id, target_user_id, requester_member_id, target_member_id,
                    status, message, review_comment,
                    requester_is_read, requester_read_at,
                    target_is_read, target_read_at, created_at
                )
                VALUES (?, ?, ?, ?, 'pending', ?, '', 1, ?, 0, NULL, ?)
                """,
                (
                    current_user_id,
                    int(target_row["id"]),
                    int(current_member_id),
                    int(target_member_id),
                    message,
                    timestamp,
                    timestamp,
                ),
            )
            request_id = int(connection.execute("SELECT last_insert_rowid() AS id").fetchone()["id"])
            connection.commit()

        broadcast_auth_event(
            {
                "type": "identity_swap_request_created",
                "request_id": request_id,
                "username": user.get("display_name") or user.get("username") or "",
            },
            lambda session: int(session.get("user_id") or 0) == int(target_row["id"]),
        )
        self.send_json({"message": "身份交换申请已提交，等待对方确认"}, status=HTTPStatus.CREATED)

    def review_identity_swap_request(self, request_id, payload, current):
        action = str(payload.get("action", "")).strip().lower()
        review_comment = str(payload.get("review_comment", payload.get("comment", ""))).strip()
        if action not in {"approve", "reject"}:
            self.send_json({"error": "操作无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        if not str(request_id).isdigit():
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return

        user = current.get("user") or {}
        reviewer_id = int(user.get("id") or 0)
        reviewer_name = user.get("display_name") or user.get("username") or "用户"
        if not reviewer_id:
            self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
            return

        with identity_swap_request_review_lock:
            with open_db() as connection:
                self.cleanup_expired_identity_swap_requests(connection)
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    """
                    SELECT *
                    FROM identity_swap_requests
                    WHERE id = ?
                    """,
                    (request_id,),
                ).fetchone()
                if not row:
                    connection.rollback()
                    self.send_json({"error": "申请不存在"}, status=HTTPStatus.NOT_FOUND)
                    return
                if int(row["target_user_id"] or 0) != reviewer_id:
                    connection.rollback()
                    self.send_json({"error": "只有被申请方可以处理该交换申请"}, status=HTTPStatus.FORBIDDEN)
                    return
                if row["status"] != "pending":
                    connection.rollback()
                    status_label = "已同意" if row["status"] == "approved" else "已拒绝"
                    self.send_json(
                        {
                            "error": f"该申请已处理过（{status_label}）",
                            "status": row["status"],
                            "reviewed_at": row["reviewed_at"],
                            "review_comment": row["review_comment"] or "",
                        },
                        status=HTTPStatus.CONFLICT,
                    )
                    return

                requester_row = connection.execute(
                    """
                    SELECT id, username, role, league, member_id, member, alliance, member_unbind_available_at
                    FROM users
                    WHERE id = ?
                    """,
                    (int(row["user_id"]),),
                ).fetchone()
                target_row = connection.execute(
                    """
                    SELECT id, username, role, league, member_id, member, alliance, member_unbind_available_at
                    FROM users
                    WHERE id = ?
                    """,
                    (int(row["target_user_id"]),),
                ).fetchone()
                if not requester_row or not target_row:
                    connection.rollback()
                    self.send_json({"error": "交换双方账号不存在"}, status=HTTPStatus.NOT_FOUND)
                    return
                if str(requester_row["member_id"] or requester_row["member"] or "") != str(row["requester_member_id"]):
                    connection.rollback()
                    self.send_json({"error": "发起方身份已变化，请重新发起申请"}, status=HTTPStatus.CONFLICT)
                    return
                if str(target_row["member_id"] or target_row["member"] or "") != str(row["target_member_id"]):
                    connection.rollback()
                    self.send_json({"error": "被申请方身份已变化，请重新发起申请"}, status=HTTPStatus.CONFLICT)
                    return

                timestamp = now_text()
                if action == "approve":
                    self.execute_identity_swap(connection, requester_row, target_row)

                updated = connection.execute(
                    """
                    UPDATE identity_swap_requests
                    SET status = ?,
                        review_comment = ?,
                        reviewed_at = ?,
                        reviewer_id = ?,
                        requester_is_read = 0,
                        requester_read_at = NULL,
                        target_is_read = 1,
                        target_read_at = ?
                    WHERE id = ? AND status = 'pending'
                    """,
                    (
                        "approved" if action == "approve" else "rejected",
                        review_comment,
                        timestamp,
                        reviewer_id,
                        timestamp,
                        int(request_id),
                    ),
                )
                if updated.rowcount != 1:
                    connection.rollback()
                    self.send_json({"error": "该申请已处理过"}, status=HTTPStatus.CONFLICT)
                    return
                connection.commit()

        if action == "approve":
            requester_identity = self._build_identity_swap_identity(target_row)
            target_identity = self._build_identity_swap_identity(requester_row)
            update_user_sessions_for_user(
                int(requester_row["id"]),
                role=requester_identity["role"],
                league=requester_identity["league"],
                member_id=requester_identity["member_id"],
                member=requester_identity["member"],
                alliance=requester_identity["alliance"],
                member_unbind_available_at=requester_identity["member_unbind_available_at"],
            )
            update_user_sessions_for_user(
                int(target_row["id"]),
                role=target_identity["role"],
                league=target_identity["league"],
                member_id=target_identity["member_id"],
                member=target_identity["member"],
                alliance=target_identity["alliance"],
                member_unbind_available_at=target_identity["member_unbind_available_at"],
            )

        broadcast_auth_event(
            {
                "type": "identity_swap_request_reviewed",
                "request_id": int(request_id),
                "status": "approved" if action == "approve" else "rejected",
                "reviewed_by": reviewer_name,
            },
            lambda session: int(session.get("user_id") or 0) in {int(requester_row["id"]), int(target_row["id"])},
        )
        self.send_json({"message": "身份交换已完成" if action == "approve" else "身份交换申请已拒绝"})

    def list_admin_role_requests(self, current, mark_read=False):
        user = current.get("user") or {}
        is_superadmin = user.get("role") == ROLE_SUPERADMIN
        with open_db() as connection:
            self.cleanup_expired_admin_role_requests(connection)
            if is_superadmin:
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
            else:
                unread_count = connection.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM admin_role_requests
                    WHERE user_id = ? AND status != 'pending' AND is_read = 0
                    """,
                    (user.get("id"),),
                ).fetchone()["count"]
                if mark_read and unread_count:
                    connection.execute(
                        """
                        UPDATE admin_role_requests
                        SET is_read = 1, read_at = ?
                        WHERE user_id = ? AND status != 'pending' AND is_read = 0
                        """,
                        (now_text(), user.get("id")),
                    )
                    connection.commit()
                rows = connection.execute(
                    """
                    SELECT r.*, u.username, u.email, u.role AS current_role
                    FROM admin_role_requests r
                    LEFT JOIN users u ON u.id = r.user_id
                    WHERE r.user_id = ?
                    ORDER BY r.id DESC
                    """,
                    (user.get("id"),),
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
                    "reviewed_at": row["reviewed_at"],
                    "reviewer_id": row["reviewer_id"],
                    "review_comment": row["review_comment"] or "",
                }
                for row in rows
            ],
            "unread_count": 0 if mark_read else unread_count,
        }

    def create_admin_role_request(self, current, payload):
        user = current.get("user") or {}
        alliance = str(payload.get("alliance", "")).strip()
        if not alliance:
            self.send_json({"error": "璇烽€夋嫨鑱旂洘"}, status=HTTPStatus.BAD_REQUEST)
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
                self.send_json({"error": "褰撳墠瑙掕壊鏃犻渶鍐嶆鐢宠"}, status=HTTPStatus.CONFLICT)
                return
            exists = connection.execute(
                """
                SELECT id FROM admin_role_requests
                WHERE user_id = ? AND status = 'pending'
                """,
                (user.get("id"),),
            ).fetchone()
            if exists:
                self.send_json({"error": "浣犲凡缁忔湁寰呭鏍哥殑鐢宠"}, status=HTTPStatus.CONFLICT)
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
        self.send_json({"message": "鑱旂洘绠＄悊鍛樼敵璇峰凡鎻愪氦"}, status=HTTPStatus.CREATED)

    def review_admin_role_request(self, request_id, payload, current):
        action = str(payload.get("action", "")).strip().lower()
        review_comment = str(payload.get("review_comment", payload.get("comment", ""))).strip()
        if action not in {"approve", "reject"}:
            self.send_json({"error": "鎿嶄綔鏃犳晥"}, status=HTTPStatus.BAD_REQUEST)
            return
        if not str(request_id).isdigit():
            self.send_json({"error": "鍙傛暟鏃犳晥"}, status=HTTPStatus.BAD_REQUEST)
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
                    SET status = 'approved', reviewed_at = ?, reviewer_id = ?, review_comment = ?
                    WHERE id = ?
                    """,
                    (
                        timestamp,
                        current.get("user", {}).get("id"),
                        str(payload.get("review_comment", payload.get("comment", ""))).strip(),
                        request_id,
                    ),
                )
                connection.commit()
                self.send_json({"message": "鑱旂洘绠＄悊鍛樼敵璇峰凡閫氳繃"})
                return
            timestamp = now_text()
            connection.execute(
                """
                UPDATE admin_role_requests
                SET status = 'rejected', reviewed_at = ?, reviewer_id = ?, review_comment = ?
                WHERE id = ?
                """,
                (
                    timestamp,
                    current.get("user", {}).get("id"),
                    str(payload.get("review_comment", payload.get("comment", ""))).strip(),
                    request_id,
                ),
            )
            connection.commit()
        self.send_json({"message": "鑱旂洘绠＄悊鍛樼敵璇峰凡鎷掔粷"})
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
            self.cleanup_expired_admin_role_requests(connection)
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
            request_id = connection.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]
            connection.commit()

        broadcast_auth_event_to_superadmins(
            {
                "type": "admin_role_request_created",
                "request_id": int(request_id),
                "request_type": request_type,
                "target_name": target_name,
                "username": user.get("display_name") or user.get("username") or "",
            }
        )
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

        review_comment = str(payload.get("review_comment", payload.get("comment", ""))).strip()
        reviewer_id = current.get("user", {}).get("id")
        reviewer_name = current.get("user", {}).get("display_name") or current.get("user", {}).get("username") or "SuperAdmin"

        with admin_role_request_review_lock:
            with open_db() as connection:
                self.cleanup_expired_admin_role_requests(connection)
                connection.execute("BEGIN IMMEDIATE")
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
                    connection.rollback()
                    self.send_json({"error": "申请不存在"}, status=HTTPStatus.NOT_FOUND)
                    return
                if row["status"] != "pending":
                    connection.rollback()
                    status_label = "已通过" if row["status"] == "approved" else "已拒绝"
                    self.send_json(
                        {
                            "error": f"该申请已处理过（{status_label}）",
                            "status": row["status"],
                            "reviewed_at": row["reviewed_at"],
                            "reviewer_id": row["reviewer_id"],
                            "review_comment": row["review_comment"] or "",
                        },
                        status=HTTPStatus.CONFLICT,
                    )
                    return

                timestamp = now_text()
                if action == "approve":
                    request_type = row["request_type"] or ROLE_REQUEST_TYPE_GUILD
                    managed_guilds = self.get_guilds_for_league_scope(connection, request_type, row["alliance"])
                    if not managed_guilds:
                        connection.rollback()
                        self.send_json({"error": "申请对应的管理范围不存在"}, status=HTTPStatus.BAD_REQUEST)
                        return
                    assigned_alliance = self.get_scope_alliance_name(connection, request_type, row["alliance"])
                    league_value = join_league_scopes(managed_guilds)
                    connection.execute(
                        """
                        UPDATE users
                        SET role = ?, alliance = ?, league = ?
                        WHERE id = ?
                        """,
                        (ROLE_ALLIANCEADMIN, assigned_alliance, league_value, row["user_id"]),
                    )
                    updated = connection.execute(
                        """
                        UPDATE admin_role_requests
                        SET status = 'approved', reviewed_at = ?, reviewer_id = ?, review_comment = ?, is_read = 0, read_at = NULL
                        WHERE id = ? AND status = 'pending'
                        """,
                        (timestamp, reviewer_id, review_comment, request_id),
                    )
                    if updated.rowcount != 1:
                        connection.rollback()
                        self.send_json({"error": "该申请已处理过"}, status=HTTPStatus.CONFLICT)
                        return
                    connection.commit()
                    update_user_sessions_for_user(
                        row["user_id"],
                        role=ROLE_ALLIANCEADMIN,
                        alliance=assigned_alliance,
                        league=league_value,
                        is_admin=False,
                    )
                    broadcast_auth_event(
                        {
                            "type": "admin_role_request_reviewed",
                            "request_id": int(request_id),
                            "status": "approved",
                            "reviewed_by": reviewer_name,
                        },
                        lambda session: (bool(session.get("is_admin")) or session.get("role") == ROLE_SUPERADMIN)
                        or int(session.get("user_id") or 0) == int(row["user_id"] or 0),
                    )
                    self.send_json({"message": "管理角色申请已通过"})
                    return

                updated = connection.execute(
                    """
                    UPDATE admin_role_requests
                    SET status = 'rejected', reviewed_at = ?, reviewer_id = ?, review_comment = ?, is_read = 0, read_at = NULL
                    WHERE id = ? AND status = 'pending'
                    """,
                    (timestamp, reviewer_id, review_comment, request_id),
                )
                if updated.rowcount != 1:
                    connection.rollback()
                    self.send_json({"error": "该申请已处理过"}, status=HTTPStatus.CONFLICT)
                    return
                connection.commit()

        broadcast_auth_event(
            {
                "type": "admin_role_request_reviewed",
                "request_id": int(request_id),
                "status": "rejected",
                "reviewed_by": reviewer_name,
            },
            lambda session: (bool(session.get("is_admin")) or session.get("role") == ROLE_SUPERADMIN)
            or int(session.get("user_id") or 0) == int(row["user_id"] or 0),
        )
        self.send_json({"message": "管理角色申请已拒绝"})
