from alliance_server.shared import broadcast_auth_event, list_group_chat_message_tables, open_db


class GroupChatDeletionMixin:
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
                    "SELECT user_id FROM group_chat_members WHERE group_chat_id = ?",
                    (int(group_chat_id),),
                ).fetchall()
            }
            invite_user_ids = {
                int(row["user_id"])
                for row in connection.execute(
                    """
                    SELECT inviter_user_id AS user_id FROM group_chat_invitations WHERE group_chat_id = ?
                    UNION
                    SELECT invitee_user_id AS user_id FROM group_chat_invitations WHERE group_chat_id = ?
                    """,
                    (int(group_chat_id), int(group_chat_id)),
                ).fetchall()
                if row["user_id"] is not None
            }

            for table_name in list_group_chat_message_tables(connection, group_chat_id):
                connection.execute(f'DROP TABLE IF EXISTS "{table_name}"')
            connection.execute(
                "DELETE FROM group_chat_message_table_registry WHERE group_chat_id = ?",
                (int(group_chat_id),),
            )
            connection.execute(
                "DELETE FROM group_chat_invitations WHERE group_chat_id = ?",
                (int(group_chat_id),),
            )
            connection.execute(
                "DELETE FROM group_chat_members WHERE group_chat_id = ?",
                (int(group_chat_id),),
            )
            connection.execute(
                "DELETE FROM group_chats WHERE id = ?",
                (int(group_chat_id),),
            )
            connection.commit()

        target_user_ids = member_ids.union(invite_user_ids)
        broadcast_auth_event(
            {
                "type": "group_chat_deleted",
                "group_chat_id": int(group_chat_id),
                "group_name": group_row["name"] or "",
            },
            lambda session: int(session.get("user_id") or 0) in target_user_ids,
        )
        self.send_json({"message": "群聊已解散"})
