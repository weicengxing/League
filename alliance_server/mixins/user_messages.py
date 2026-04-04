from http import HTTPStatus

from alliance_server.shared import (
    broadcast_auth_event,
    insert_user_message_copy,
    list_user_message_tables,
    now_text,
    open_db,
)


class UserMessagesMixin:
    def list_user_message_options(self, current):
        user = current.get("user") or {}
        current_user_id = int(user.get("id") or 0)
        if not current_user_id:
            return {"items": []}

        with open_db() as connection:
            rows = connection.execute(
                """
                SELECT u.id,
                       u.username,
                       u.email,
                       u.role,
                       COALESCE(u.member_id, u.member) AS linked_member_id,
                       m.name AS member_name,
                       m.alliance AS alliance,
                       m.guild AS guild
                FROM users u
                LEFT JOIN members m ON m.id = COALESCE(u.member_id, u.member)
                WHERE u.is_active = 1
                  AND u.id <> ?
                ORDER BY COALESCE(m.name, u.username) COLLATE NOCASE ASC, u.id ASC
                """,
                (current_user_id,),
            ).fetchall()

        items = []
        for row in rows:
            label = row["member_name"] or row["username"] or f"用户#{row['id']}"
            subtitle_parts = [part for part in [row["alliance"], row["guild"], row["username"]] if part]
            items.append(
                {
                    "user_id": int(row["id"]),
                    "username": row["username"] or "",
                    "email": row["email"] or "",
                    "role": row["role"] or "",
                    "member_id": int(row["linked_member_id"]) if row["linked_member_id"] else None,
                    "member_name": row["member_name"] or "",
                    "alliance": row["alliance"] or "",
                    "guild": row["guild"] or "",
                    "label": label,
                    "subtitle": " / ".join(subtitle_parts),
                }
            )
        return {"items": items}

    def list_user_messages(self, current, mark_read=False, limit=200):
        user = current.get("user") or {}
        user_id = int(user.get("id") or 0)
        if not user_id:
            return {"items": [], "unread_count": 0}

        with open_db() as connection:
            table_names = list_user_message_tables(connection, user_id)
            if not table_names:
                return {"items": [], "unread_count": 0}

            union_sql = " UNION ALL ".join(
                [
                    f"""
                    SELECT id, sender_user_id, receiver_user_id, counterpart_user_id, direction, message, is_read, created_at, '{table_name}' AS source_table
                    FROM "{table_name}"
                    """
                    for table_name in table_names
                ]
            )

            unread_count = 0
            for table_name in table_names:
                unread_count += int(
                    connection.execute(
                        f'SELECT COUNT(*) AS count FROM "{table_name}" WHERE direction = ? AND is_read = 0',
                        ("in",),
                    ).fetchone()["count"]
                )

            if mark_read:
                for table_name in table_names:
                    connection.execute(
                        f"""
                        UPDATE "{table_name}"
                        SET is_read = 1
                        WHERE direction = ? AND is_read = 0
                        """,
                        ("in",),
                    )
                connection.commit()

            rows = connection.execute(
                f"""
                SELECT msg.*,
                       counterpart.username AS counterpart_username,
                       counterpart.role AS counterpart_role,
                       COALESCE(member.name, counterpart.username) AS counterpart_name,
                       member.alliance AS counterpart_alliance,
                       member.guild AS counterpart_guild
                FROM ({union_sql}) AS msg
                LEFT JOIN users counterpart ON counterpart.id = msg.counterpart_user_id
                LEFT JOIN members member ON member.id = COALESCE(counterpart.member_id, counterpart.member)
                ORDER BY msg.created_at DESC, msg.id DESC
                LIMIT ?
                """,
                (int(limit),),
            ).fetchall()

        items = []
        for row in rows:
            items.append(
                {
                    "id": int(row["id"]),
                    "source_table": row["source_table"],
                    "sender_user_id": int(row["sender_user_id"]),
                    "receiver_user_id": int(row["receiver_user_id"]),
                    "counterpart_user_id": int(row["counterpart_user_id"]),
                    "direction": row["direction"] or "in",
                    "message": row["message"] or "",
                    "is_read": 1 if mark_read else int(row["is_read"] or 0),
                    "created_at": row["created_at"] or "",
                    "counterpart_username": row["counterpart_username"] or "",
                    "counterpart_role": row["counterpart_role"] or "Guest",
                    "counterpart_name": row["counterpart_name"] or row["counterpart_username"] or "",
                    "counterpart_alliance": row["counterpart_alliance"] or "",
                    "counterpart_guild": row["counterpart_guild"] or "",
                }
            )

        return {"items": items, "unread_count": 0 if mark_read else unread_count}

    def create_user_message(self, current, payload):
        user = current.get("user") or {}
        sender_user_id = int(user.get("id") or 0)
        target_user_id = int(payload.get("target_user_id") or 0)
        message = str(payload.get("message", "")).strip()
        if not sender_user_id:
            self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
            return
        if not target_user_id:
            self.send_json({"error": "请选择留言对象"}, status=HTTPStatus.BAD_REQUEST)
            return
        if target_user_id == sender_user_id:
            self.send_json({"error": "不能给自己留言"}, status=HTTPStatus.BAD_REQUEST)
            return
        if not message:
            self.send_json({"error": "留言内容不能为空"}, status=HTTPStatus.BAD_REQUEST)
            return
        if len(message) > 2000:
            self.send_json({"error": "留言内容不能超过 2000 字"}, status=HTTPStatus.BAD_REQUEST)
            return

        with open_db() as connection:
            target_row = connection.execute(
                """
                SELECT id
                FROM users
                WHERE id = ? AND is_active = 1
                LIMIT 1
                """,
                (target_user_id,),
            ).fetchone()
            if not target_row:
                self.send_json({"error": "目标用户不存在"}, status=HTTPStatus.NOT_FOUND)
                return

            created_at = now_text()
            insert_user_message_copy(
                connection,
                owner_user_id=sender_user_id,
                sender_user_id=sender_user_id,
                receiver_user_id=target_user_id,
                counterpart_user_id=target_user_id,
                direction="out",
                message=message,
                is_read=True,
                created_at=created_at,
            )
            insert_user_message_copy(
                connection,
                owner_user_id=target_user_id,
                sender_user_id=sender_user_id,
                receiver_user_id=target_user_id,
                counterpart_user_id=sender_user_id,
                direction="in",
                message=message,
                is_read=False,
                created_at=created_at,
            )
            connection.commit()

        sender_name = user.get("display_name") or user.get("username") or f"用户#{sender_user_id}"
        broadcast_auth_event(
            {
                "type": "user_message_created",
                "from_user_id": sender_user_id,
                "from_name": sender_name,
                "message_preview": message[:50],
                "created_at": created_at,
            },
            lambda session: int(session.get("user_id") or 0) == target_user_id,
        )
        self.send_json(
            {
                "message": "留言已发送",
                "item": {
                    "sender_user_id": sender_user_id,
                    "receiver_user_id": target_user_id,
                    "counterpart_user_id": target_user_id,
                    "direction": "out",
                    "message": message,
                    "is_read": 1,
                    "created_at": created_at,
                },
            },
            status=HTTPStatus.CREATED,
        )
