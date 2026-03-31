from http import HTTPStatus

from alliance_server.shared import (
    broadcast_auth_event,
    insert_group_chat_message,
    list_group_chat_message_tables,
    now_text,
    open_db,
    split_league_scopes,
)
from auth import ROLE_ALLIANCEADMIN, ROLE_GUEST, ROLE_SUPERADMIN, ROLE_VERIFIEDUSER, normalize_role


GROUP_CHAT_MUTE_FOREVER = "9999-12-31 23:59:59"


class GroupChatsMixin:
    def _group_chat_role_kind(self, user):
        role = normalize_role(user.get("role"))
        if role == ROLE_SUPERADMIN:
            return "superadmin"
        if role == ROLE_ALLIANCEADMIN:
            scope_count = len(split_league_scopes(user.get("league")))
            return "alliance_leader" if scope_count > 1 else "guild_leader"
        if role == ROLE_VERIFIEDUSER:
            return "verified"
        return "guest"

    def _group_chat_limit_for_user(self, user):
        kind = self._group_chat_role_kind(user)
        if kind == "superadmin":
            return None
        if kind == "alliance_leader":
            return 40
        if kind == "guild_leader":
            return 20
        if kind == "verified":
            return 5
        return 0

    def _get_group_chat_row(self, connection, group_chat_id):
        return connection.execute(
            """
            SELECT *
            FROM group_chats
            WHERE id = ? AND status = 'active'
            LIMIT 1
            """,
            (int(group_chat_id),),
        ).fetchone()

    def _get_group_membership(self, connection, group_chat_id, user_id):
        return connection.execute(
            """
            SELECT *
            FROM group_chat_members
            WHERE group_chat_id = ? AND user_id = ? AND status = 'active'
            LIMIT 1
            """,
            (int(group_chat_id), int(user_id)),
        ).fetchone()

    def _list_group_members(self, connection, group_chat_id):
        rows = connection.execute(
            """
            SELECT gm.user_id,
                   gm.member_role,
                   gm.status,
                   gm.muted_until,
                   gm.last_read_message_at,
                   gm.joined_at,
                   u.username,
                   u.role AS user_role,
                   COALESCE(m.name, u.username) AS display_name,
                   m.alliance,
                   m.guild
            FROM group_chat_members gm
            LEFT JOIN users u ON u.id = gm.user_id
            LEFT JOIN members m ON m.id = COALESCE(u.member_id, u.member)
            WHERE gm.group_chat_id = ? AND gm.status = 'active'
            ORDER BY CASE WHEN gm.member_role = 'owner' THEN 0 ELSE 1 END, gm.joined_at ASC, gm.id ASC
            """,
            (int(group_chat_id),),
        ).fetchall()
        return [
            {
                "user_id": int(row["user_id"]),
                "member_role": row["member_role"] or "member",
                "status": row["status"] or "active",
                "muted_until": row["muted_until"] or "",
                "last_read_message_at": row["last_read_message_at"] or "",
                "joined_at": row["joined_at"] or "",
                "username": row["username"] or "",
                "user_role": row["user_role"] or ROLE_GUEST,
                "display_name": row["display_name"] or row["username"] or f"用户#{row['user_id']}",
                "alliance": row["alliance"] or "",
                "guild": row["guild"] or "",
            }
            for row in rows
        ]

    def _serialize_group_row(self, connection, row, current_user_id):
        members = self._list_group_members(connection, row["id"])
        current_member = next((item for item in members if int(item["user_id"]) == int(current_user_id)), None)
        last_message_at = str(row["last_message_at"] or "").strip()
        last_read_message_at = str((current_member or {}).get("last_read_message_at") or "").strip()
        last_sender_id = int(row["last_message_sender_user_id"] or 0)
        unread = int(bool(current_member and last_message_at and last_sender_id != int(current_user_id) and last_message_at != last_read_message_at))
        return {
            "id": int(row["id"]),
            "name": row["name"] or "",
            "owner_user_id": int(row["owner_user_id"]),
            "status": row["status"] or "active",
            "member_count": int(row["member_count"] or len(members)),
            "last_message_at": row["last_message_at"] or "",
            "last_message_sender_user_id": int(row["last_message_sender_user_id"] or 0) if row["last_message_sender_user_id"] else None,
            "last_message_preview": row["last_message_preview"] or "",
            "created_at": row["created_at"] or "",
            "updated_at": row["updated_at"] or "",
            "my_member_role": (current_member or {}).get("member_role", ""),
            "my_muted_until": (current_member or {}).get("muted_until", ""),
            "my_last_read_message_at": (current_member or {}).get("last_read_message_at", ""),
            "unread_count": unread,
            "members": members,
        }

    def _require_group_owner(self, connection, group_chat_id, user_id):
        membership = self._get_group_membership(connection, group_chat_id, user_id)
        if not membership:
            self.send_json({"error": "你不在该群聊中"}, status=HTTPStatus.FORBIDDEN)
            return None, None
        if membership["member_role"] != "owner":
            self.send_json({"error": "只有群主可以执行该操作"}, status=HTTPStatus.FORBIDDEN)
            return None, None
        group_row = self._get_group_chat_row(connection, group_chat_id)
        if not group_row:
            self.send_json({"error": "群聊不存在"}, status=HTTPStatus.NOT_FOUND)
            return None, None
        return group_row, membership

    def list_group_chats(self, current):
        user = current.get("user") or {}
        user_id = int(user.get("id") or 0)
        if not user_id:
            return {"items": [], "unread_count": 0, "create_limit": 0, "created_count": 0}
        with open_db() as connection:
            rows = connection.execute(
                """
                SELECT gc.*
                FROM group_chat_members gm
                INNER JOIN group_chats gc ON gc.id = gm.group_chat_id
                WHERE gm.user_id = ? AND gm.status = 'active' AND gc.status = 'active'
                ORDER BY COALESCE(gc.last_message_at, gc.updated_at, gc.created_at) DESC, gc.id DESC
                """,
                (user_id,),
            ).fetchall()
            items = [self._serialize_group_row(connection, row, user_id) for row in rows]
            created_count = int(
                connection.execute(
                    "SELECT COUNT(*) AS count FROM group_chats WHERE owner_user_id = ? AND status = 'active'",
                    (user_id,),
                ).fetchone()["count"]
            )
        return {
            "items": items,
            "unread_count": sum(int(item["unread_count"] or 0) for item in items),
            "create_limit": self._group_chat_limit_for_user(user),
            "created_count": created_count,
            "role_kind": self._group_chat_role_kind(user),
        }

    def list_group_chat_messages(self, current, group_chat_id, mark_read=False, limit=100):
        user = current.get("user") or {}
        user_id = int(user.get("id") or 0)
        if not user_id:
            self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
            return
        with open_db() as connection:
            group_row = self._get_group_chat_row(connection, group_chat_id)
            if not group_row:
                self.send_json({"error": "群聊不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            membership = self._get_group_membership(connection, group_chat_id, user_id)
            if not membership:
                self.send_json({"error": "你不在该群聊中"}, status=HTTPStatus.FORBIDDEN)
                return
            table_names = list_group_chat_message_tables(connection, group_chat_id)
            if not table_names:
                if mark_read:
                    connection.execute(
                        """
                        UPDATE group_chat_members
                        SET last_read_message_at = ?, updated_at = ?
                        WHERE group_chat_id = ? AND user_id = ?
                        """,
                        (group_row["last_message_at"], now_text(), int(group_chat_id), user_id),
                    )
                    connection.commit()
                self.send_json({"items": [], "group": self._serialize_group_row(connection, group_row, user_id)})
                return
            union_sql = " UNION ALL ".join(
                [
                    f"""
                    SELECT id, sender_user_id, message, created_at, '{table_name}' AS source_table
                    FROM "{table_name}"
                    """
                    for table_name in table_names
                ]
            )
            rows = connection.execute(
                f"""
                SELECT msg.*,
                       u.username,
                       u.role AS user_role,
                       COALESCE(m.name, u.username) AS display_name,
                       m.alliance,
                       m.guild
                FROM ({union_sql}) AS msg
                LEFT JOIN users u ON u.id = msg.sender_user_id
                LEFT JOIN members m ON m.id = COALESCE(u.member_id, u.member)
                ORDER BY msg.created_at DESC, msg.id DESC
                LIMIT ?
                """,
                (max(1, min(200, int(limit))),),
            ).fetchall()
            if mark_read:
                connection.execute(
                    """
                    UPDATE group_chat_members
                    SET last_read_message_at = ?, updated_at = ?
                    WHERE group_chat_id = ? AND user_id = ?
                    """,
                    (group_row["last_message_at"], now_text(), int(group_chat_id), user_id),
                )
                connection.commit()
                group_row = self._get_group_chat_row(connection, group_chat_id)
            items = [
                {
                    "id": int(row["id"]),
                    "source_table": row["source_table"],
                    "sender_user_id": int(row["sender_user_id"]),
                    "message": row["message"] or "",
                    "created_at": row["created_at"] or "",
                    "username": row["username"] or "",
                    "sender_role": row["user_role"] or ROLE_GUEST,
                    "display_name": row["display_name"] or row["username"] or f"用户#{row['sender_user_id']}",
                    "alliance": row["alliance"] or "",
                    "guild": row["guild"] or "",
                    "is_self": int(row["sender_user_id"]) == user_id,
                }
                for row in reversed(rows)
            ]
            self.send_json({"items": items, "group": self._serialize_group_row(connection, group_row, user_id)})

    def create_group_chat(self, current, payload):
        user = current.get("user") or {}
        user_id = int(user.get("id") or 0)
        if not user_id:
            self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
            return
        name = str(payload.get("name", "")).strip()
        if not name:
            self.send_json({"error": "请输入群聊名称"}, status=HTTPStatus.BAD_REQUEST)
            return
        if len(name) > 40:
            self.send_json({"error": "群聊名称不能超过 40 个字"}, status=HTTPStatus.BAD_REQUEST)
            return
        if not self.has_permission(user, "create_group_chat"):
            self.send_json({"error": "当前角色不能建群"}, status=HTTPStatus.FORBIDDEN)
            return
        create_limit = self._group_chat_limit_for_user(user)
        with open_db() as connection:
            created_count = int(
                connection.execute(
                    "SELECT COUNT(*) AS count FROM group_chats WHERE owner_user_id = ? AND status = 'active'",
                    (user_id,),
                ).fetchone()["count"]
            )
            if create_limit is not None and created_count >= create_limit:
                self.send_json({"error": f"当前角色最多只能创建 {create_limit} 个群聊"}, status=HTTPStatus.CONFLICT)
                return
            timestamp = now_text()
            cursor = connection.execute(
                """
                INSERT INTO group_chats (
                    name, owner_user_id, status, member_count, created_at, updated_at
                ) VALUES (?, ?, 'active', 1, ?, ?)
                """,
                (name, user_id, timestamp, timestamp),
            )
            group_chat_id = int(cursor.lastrowid or 0)
            connection.execute(
                """
                INSERT INTO group_chat_members (
                    group_chat_id, user_id, member_role, status, muted_until, last_read_message_at, joined_at, updated_at
                ) VALUES (?, ?, 'owner', 'active', NULL, NULL, ?, ?)
                """,
                (group_chat_id, user_id, timestamp, timestamp),
            )
            group_row = self._get_group_chat_row(connection, group_chat_id)
            connection.commit()
            item = self._serialize_group_row(connection, group_row, user_id)
        self.send_json({"message": "群聊创建成功", "item": item}, status=HTTPStatus.CREATED)

    def create_group_chat_message(self, current, group_chat_id, payload):
        user = current.get("user") or {}
        user_id = int(user.get("id") or 0)
        if not user_id:
            self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
            return
        message = str(payload.get("message", "")).strip()
        if not message:
            self.send_json({"error": "消息内容不能为空"}, status=HTTPStatus.BAD_REQUEST)
            return
        if len(message) > 2000:
            self.send_json({"error": "消息内容不能超过 2000 个字"}, status=HTTPStatus.BAD_REQUEST)
            return
        with open_db() as connection:
            group_row = self._get_group_chat_row(connection, group_chat_id)
            if not group_row:
                self.send_json({"error": "群聊不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            membership = self._get_group_membership(connection, group_chat_id, user_id)
            if not membership:
                self.send_json({"error": "你不在该群聊中"}, status=HTTPStatus.FORBIDDEN)
                return
            muted_until = str(membership["muted_until"] or "").strip()
            if muted_until and muted_until > now_text():
                self.send_json({"error": "你已被群主禁言"}, status=HTTPStatus.FORBIDDEN)
                return
            created_at = now_text()
            insert_result = insert_group_chat_message(
                connection,
                group_chat_id=group_chat_id,
                sender_user_id=user_id,
                message=message,
                created_at=created_at,
            )
            preview = message[:80]
            connection.execute(
                """
                UPDATE group_chats
                SET last_message_at = ?, last_message_sender_user_id = ?, last_message_preview = ?, updated_at = ?
                WHERE id = ?
                """,
                (created_at, user_id, preview, created_at, int(group_chat_id)),
            )
            connection.execute(
                """
                UPDATE group_chat_members
                SET last_read_message_at = ?, updated_at = ?
                WHERE group_chat_id = ? AND user_id = ?
                """,
                (created_at, created_at, int(group_chat_id), user_id),
            )
            connection.commit()
            group_row = self._get_group_chat_row(connection, group_chat_id)
            members = self._list_group_members(connection, group_chat_id)
            item = {
                "id": int(insert_result["message_id"]),
                "source_table": insert_result["table_name"],
                "table_seq": int(insert_result["table_seq"]),
                "sender_user_id": user_id,
                "message": message,
                "created_at": created_at,
                "username": user.get("username") or "",
                "sender_role": user.get("role") or ROLE_GUEST,
                "display_name": user.get("display_name") or user.get("username") or f"用户#{user_id}",
                "is_self": True,
            }
        target_ids = {int(member["user_id"]) for member in members if int(member["user_id"]) != user_id}
        broadcast_auth_event(
            {
                "type": "group_chat_message_created",
                "group_chat_id": int(group_chat_id),
                "group_name": group_row["name"] or "",
                "from_user_id": user_id,
                "from_name": user.get("display_name") or user.get("username") or f"用户#{user_id}",
                "message_preview": message[:50],
                "created_at": created_at,
            },
            lambda session: int(session.get("user_id") or 0) in target_ids,
        )
        self.send_json({"message": "消息已发送", "item": item})

    def create_group_chat_invitation(self, current, group_chat_id, payload):
        user = current.get("user") or {}
        user_id = int(user.get("id") or 0)
        invitee_user_id = int(payload.get("invitee_user_id") or 0)
        message = str(payload.get("message", "")).strip()
        if not invitee_user_id:
            self.send_json({"error": "请选择邀请对象"}, status=HTTPStatus.BAD_REQUEST)
            return
        if invitee_user_id == user_id:
            self.send_json({"error": "不能邀请自己"}, status=HTTPStatus.BAD_REQUEST)
            return
        if len(message) > 300:
            self.send_json({"error": "邀请留言不能超过 300 个字"}, status=HTTPStatus.BAD_REQUEST)
            return
        with open_db() as connection:
            group_row, _ = self._require_group_owner(connection, group_chat_id, user_id)
            if not group_row:
                return
            invitee = connection.execute(
                "SELECT id, username, is_active FROM users WHERE id = ? LIMIT 1",
                (invitee_user_id,),
            ).fetchone()
            if not invitee or int(invitee["is_active"] or 0) != 1:
                self.send_json({"error": "邀请对象不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            existing_member = self._get_group_membership(connection, group_chat_id, invitee_user_id)
            if existing_member:
                self.send_json({"error": "该用户已在群聊中"}, status=HTTPStatus.CONFLICT)
                return
            existing_pending = connection.execute(
                """
                SELECT id
                FROM group_chat_invitations
                WHERE group_chat_id = ? AND invitee_user_id = ? AND status = 'pending'
                LIMIT 1
                """,
                (int(group_chat_id), invitee_user_id),
            ).fetchone()
            if existing_pending:
                self.send_json({"error": "该用户已有待处理邀请"}, status=HTTPStatus.CONFLICT)
                return
            timestamp = now_text()
            cursor = connection.execute(
                """
                INSERT INTO group_chat_invitations (
                    group_chat_id, inviter_user_id, invitee_user_id, status, message,
                    response_message, is_read_inviter, inviter_read_at, is_read_invitee, invitee_read_at, created_at
                ) VALUES (?, ?, ?, 'pending', ?, '', 1, ?, 0, NULL, ?)
                """,
                (int(group_chat_id), user_id, invitee_user_id, message, timestamp, timestamp),
            )
            invitation_id = int(cursor.lastrowid or 0)
            connection.commit()
        broadcast_auth_event(
            {
                "type": "group_chat_invitation_created",
                "invitation_id": invitation_id,
                "group_chat_id": int(group_chat_id),
                "group_name": group_row["name"] or "",
                "from_user_id": user_id,
                "from_name": user.get("display_name") or user.get("username") or f"用户#{user_id}",
            },
            lambda session: int(session.get("user_id") or 0) == invitee_user_id,
        )
        self.send_json({"message": "入群邀请已发出"}, status=HTTPStatus.CREATED)

    def list_group_chat_invitations(self, current, mark_read=False):
        user = current.get("user") or {}
        user_id = int(user.get("id") or 0)
        if not user_id:
            return {"items": [], "unread_count": 0}
        with open_db() as connection:
            rows = connection.execute(
                """
                SELECT i.*,
                       gc.name AS group_name,
                       inviter.username AS inviter_username,
                       invitee.username AS invitee_username,
                       COALESCE(inviter_member.name, inviter.username) AS inviter_display_name,
                       COALESCE(invitee_member.name, invitee.username) AS invitee_display_name
                FROM group_chat_invitations i
                LEFT JOIN group_chats gc ON gc.id = i.group_chat_id
                LEFT JOIN users inviter ON inviter.id = i.inviter_user_id
                LEFT JOIN users invitee ON invitee.id = i.invitee_user_id
                LEFT JOIN members inviter_member ON inviter_member.id = COALESCE(inviter.member_id, inviter.member)
                LEFT JOIN members invitee_member ON invitee_member.id = COALESCE(invitee.member_id, invitee.member)
                WHERE i.inviter_user_id = ? OR i.invitee_user_id = ?
                ORDER BY i.id DESC
                """,
                (user_id, user_id),
            ).fetchall()
            unread_invitee_ids = [
                int(row["id"])
                for row in rows
                if int(row["invitee_user_id"] or 0) == user_id and row["status"] == "pending" and int(row["is_read_invitee"] or 0) == 0
            ]
            unread_inviter_ids = [
                int(row["id"])
                for row in rows
                if int(row["inviter_user_id"] or 0) == user_id and row["status"] != "pending" and int(row["is_read_inviter"] or 0) == 0
            ]
            if mark_read:
                timestamp = now_text()
                if unread_invitee_ids:
                    placeholders = ",".join("?" for _ in unread_invitee_ids)
                    connection.execute(
                        f"""
                        UPDATE group_chat_invitations
                        SET is_read_invitee = 1, invitee_read_at = ?
                        WHERE id IN ({placeholders})
                        """,
                        (timestamp, *unread_invitee_ids),
                    )
                if unread_inviter_ids:
                    placeholders = ",".join("?" for _ in unread_inviter_ids)
                    connection.execute(
                        f"""
                        UPDATE group_chat_invitations
                        SET is_read_inviter = 1, inviter_read_at = ?
                        WHERE id IN ({placeholders})
                        """,
                        (timestamp, *unread_inviter_ids),
                    )
                if unread_invitee_ids or unread_inviter_ids:
                    connection.commit()
            items = [
                {
                    "id": int(row["id"]),
                    "group_chat_id": int(row["group_chat_id"]),
                    "group_name": row["group_name"] or "",
                    "inviter_user_id": int(row["inviter_user_id"]),
                    "invitee_user_id": int(row["invitee_user_id"]),
                    "inviter_username": row["inviter_username"] or "",
                    "invitee_username": row["invitee_username"] or "",
                    "inviter_display_name": row["inviter_display_name"] or row["inviter_username"] or "",
                    "invitee_display_name": row["invitee_display_name"] or row["invitee_username"] or "",
                    "status": row["status"] or "pending",
                    "message": row["message"] or "",
                    "response_message": row["response_message"] or "",
                    "created_at": row["created_at"] or "",
                    "responded_at": row["responded_at"] or "",
                    "is_outgoing": int(row["inviter_user_id"]) == user_id,
                    "can_review": int(row["invitee_user_id"]) == user_id and (row["status"] or "pending") == "pending",
                }
                for row in rows
            ]
        unread_count = 0 if mark_read else len(unread_invitee_ids) + len(unread_inviter_ids)
        return {"items": items, "unread_count": unread_count}

    def review_group_chat_invitation(self, current, invitation_id, payload):
        user = current.get("user") or {}
        user_id = int(user.get("id") or 0)
        action = str(payload.get("action", "")).strip().lower()
        response_message = str(payload.get("response_message", "")).strip()
        if action not in {"accept", "reject"}:
            self.send_json({"error": "操作无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        if len(response_message) > 300:
            self.send_json({"error": "回复留言不能超过 300 个字"}, status=HTTPStatus.BAD_REQUEST)
            return
        with open_db() as connection:
            row = connection.execute(
                """
                SELECT i.*, gc.name AS group_name
                FROM group_chat_invitations i
                LEFT JOIN group_chats gc ON gc.id = i.group_chat_id
                WHERE i.id = ?
                LIMIT 1
                """,
                (int(invitation_id),),
            ).fetchone()
            if not row:
                self.send_json({"error": "邀请不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            if int(row["invitee_user_id"] or 0) != user_id:
                self.send_json({"error": "只有被邀请人可以处理邀请"}, status=HTTPStatus.FORBIDDEN)
                return
            if (row["status"] or "pending") != "pending":
                self.send_json({"error": "该邀请已处理"}, status=HTTPStatus.CONFLICT)
                return
            group_row = self._get_group_chat_row(connection, row["group_chat_id"])
            if not group_row:
                self.send_json({"error": "群聊不存在或已解散"}, status=HTTPStatus.CONFLICT)
                return
            timestamp = now_text()
            next_status = "accepted" if action == "accept" else "rejected"
            if action == "accept":
                membership = self._get_group_membership(connection, row["group_chat_id"], user_id)
                if membership:
                    self.send_json({"error": "你已在该群聊中"}, status=HTTPStatus.CONFLICT)
                    return
                connection.execute(
                    """
                    INSERT INTO group_chat_members (
                        group_chat_id, user_id, member_role, status, muted_until, last_read_message_at, joined_at, updated_at
                    ) VALUES (?, ?, 'member', 'active', NULL, ?, ?, ?)
                    """,
                    (int(row["group_chat_id"]), user_id, group_row["last_message_at"], timestamp, timestamp),
                )
                connection.execute(
                    """
                    UPDATE group_chats
                    SET member_count = member_count + 1, updated_at = ?
                    WHERE id = ?
                    """,
                    (timestamp, int(row["group_chat_id"])),
                )
            connection.execute(
                """
                UPDATE group_chat_invitations
                SET status = ?, response_message = ?, responded_at = ?, is_read_inviter = 0, inviter_read_at = NULL,
                    is_read_invitee = 1, invitee_read_at = ?
                WHERE id = ?
                """,
                (next_status, response_message, timestamp, timestamp, int(invitation_id)),
            )
            connection.commit()
        broadcast_auth_event(
            {
                "type": "group_chat_invitation_reviewed",
                "invitation_id": int(invitation_id),
                "group_chat_id": int(row["group_chat_id"]),
                "group_name": row["group_name"] or "",
                "status": next_status,
                "reviewed_by": user.get("display_name") or user.get("username") or f"用户#{user_id}",
            },
            lambda session: int(session.get("user_id") or 0) == int(row["inviter_user_id"] or 0),
        )
        self.send_json({"message": "已加入群聊" if action == "accept" else "已拒绝邀请"})

    def set_group_chat_member_mute(self, current, group_chat_id, payload):
        user = current.get("user") or {}
        user_id = int(user.get("id") or 0)
        member_user_id = int(payload.get("member_user_id") or 0)
        muted = bool(payload.get("muted"))
        if not member_user_id:
            self.send_json({"error": "请选择成员"}, status=HTTPStatus.BAD_REQUEST)
            return
        if member_user_id == user_id:
            self.send_json({"error": "不能对自己执行该操作"}, status=HTTPStatus.BAD_REQUEST)
            return
        with open_db() as connection:
            group_row, _ = self._require_group_owner(connection, group_chat_id, user_id)
            if not group_row:
                return
            target_membership = self._get_group_membership(connection, group_chat_id, member_user_id)
            if not target_membership:
                self.send_json({"error": "该成员不在群聊中"}, status=HTTPStatus.NOT_FOUND)
                return
            timestamp = now_text()
            muted_until = GROUP_CHAT_MUTE_FOREVER if muted else None
            connection.execute(
                """
                UPDATE group_chat_members
                SET muted_until = ?, updated_at = ?
                WHERE group_chat_id = ? AND user_id = ?
                """,
                (muted_until, timestamp, int(group_chat_id), member_user_id),
            )
            connection.commit()
        broadcast_auth_event(
            {
                "type": "group_chat_member_updated",
                "group_chat_id": int(group_chat_id),
                "member_user_id": member_user_id,
                "muted": muted,
            },
            lambda session: int(session.get("user_id") or 0) in {member_user_id, user_id},
        )
        self.send_json({"message": "已禁言该成员" if muted else "已取消禁言"})

    def remove_group_chat_member(self, current, group_chat_id, member_user_id):
        user = current.get("user") or {}
        user_id = int(user.get("id") or 0)
        member_user_id = int(member_user_id or 0)
        if not member_user_id:
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        if member_user_id == user_id:
            self.send_json({"error": "群主不能移除自己，请直接解散群聊"}, status=HTTPStatus.BAD_REQUEST)
            return
        with open_db() as connection:
            group_row, _ = self._require_group_owner(connection, group_chat_id, user_id)
            if not group_row:
                return
            target_membership = self._get_group_membership(connection, group_chat_id, member_user_id)
            if not target_membership:
                self.send_json({"error": "该成员不在群聊中"}, status=HTTPStatus.NOT_FOUND)
                return
            timestamp = now_text()
            connection.execute(
                """
                UPDATE group_chat_members
                SET status = 'removed', updated_at = ?
                WHERE group_chat_id = ? AND user_id = ?
                """,
                (timestamp, int(group_chat_id), member_user_id),
            )
            connection.execute(
                """
                UPDATE group_chats
                SET member_count = CASE WHEN member_count > 0 THEN member_count - 1 ELSE 0 END, updated_at = ?
                WHERE id = ?
                """,
                (timestamp, int(group_chat_id)),
            )
            connection.execute(
                """
                UPDATE group_chat_invitations
                SET status = 'removed', response_message = '已被群主移出群聊', responded_at = ?, is_read_invitee = 0, invitee_read_at = NULL
                WHERE group_chat_id = ? AND invitee_user_id = ? AND status = 'accepted'
                """,
                (timestamp, int(group_chat_id), member_user_id),
            )
            connection.commit()
        broadcast_auth_event(
            {
                "type": "group_chat_member_removed",
                "group_chat_id": int(group_chat_id),
                "member_user_id": member_user_id,
            },
            lambda session: int(session.get("user_id") or 0) in {member_user_id, user_id},
        )
        self.send_json({"message": "已移除该成员"})

    def delete_group_chat(self, current, group_chat_id):
        user = current.get("user") or {}
        user_id = int(user.get("id") or 0)
        with open_db() as connection:
            group_row, _ = self._require_group_owner(connection, group_chat_id, user_id)
            if not group_row:
                return
            member_ids = {
                int(row["user_id"])
                for row in connection.execute(
                    "SELECT user_id FROM group_chat_members WHERE group_chat_id = ? AND status = 'active'",
                    (int(group_chat_id),),
                ).fetchall()
            }
            timestamp = now_text()
            connection.execute(
                """
                UPDATE group_chats
                SET status = 'disbanded', updated_at = ?
                WHERE id = ?
                """,
                (timestamp, int(group_chat_id)),
            )
            connection.execute(
                """
                UPDATE group_chat_members
                SET status = 'removed', updated_at = ?
                WHERE group_chat_id = ?
                """,
                (timestamp, int(group_chat_id)),
            )
            connection.execute(
                """
                UPDATE group_chat_invitations
                SET status = CASE WHEN status = 'pending' THEN 'cancelled' ELSE status END,
                    responded_at = COALESCE(responded_at, ?)
                WHERE group_chat_id = ?
                """,
                (timestamp, int(group_chat_id)),
            )
            connection.commit()
        broadcast_auth_event(
            {
                "type": "group_chat_deleted",
                "group_chat_id": int(group_chat_id),
                "group_name": group_row["name"] or "",
            },
            lambda session: int(session.get("user_id") or 0) in member_ids,
        )
        self.send_json({"message": "群聊已解散"})
