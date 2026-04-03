from alliance_server.shared import *

from auth import (
    ROLE_SUPERADMIN,
    get_current_auth,
    invalidate_user_sessions,
    normalize_league_scope,
    normalize_role,
)


class DatabaseAdminMixin:
    def handle_db_api(self, parsed):
        """Handle database admin GET requests."""
        current = get_current_auth(self)
        if not current.get("authenticated") or current.get("user", {}).get("role") != ROLE_SUPERADMIN:
            self.send_json({"error": "只有超级管理员可以访问数据库管理"}, status=HTTPStatus.FORBIDDEN)
            return

        path_parts = parsed.path.strip("/").split("/")

        if len(path_parts) >= 3 and path_parts[2] == "export":
            self.export_db_file()
            return

        if len(path_parts) >= 3 and path_parts[2] == "tables":
            self.send_json(self.list_db_tables())
            return

        if len(path_parts) >= 4 and path_parts[2] == "table":
            table_name = unquote(path_parts[3])
            if len(path_parts) == 5:
                record_id = path_parts[4]
                self.send_json(self.get_db_table_record(table_name, record_id))
            else:
                self.send_json(self.get_db_table_data(table_name))
            return

        self.send_json({"error": "无效的数据库 API 路径"}, status=HTTPStatus.BAD_REQUEST)

    def list_db_tables(self):
        with open_db() as connection:
            rows = connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            ).fetchall()
        tables = [row["name"] for row in rows if row["name"] != "admins"]
        return {"tables": tables}

    def get_db_table_data(self, table_name):
        with open_db() as connection:
            try:
                columns = [row["name"] for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()]
                rows = connection.execute(f"SELECT * FROM {table_name} ORDER BY id DESC").fetchall()
                items = [dict(row) for row in rows]
                return {"table": table_name, "columns": columns, "items": items, "count": len(items)}
            except sqlite3.OperationalError as error:
                return {"error": str(error)}

    def get_db_table_record(self, table_name, record_id):
        if not record_id.isdigit():
            return {"error": "无效的记录 ID"}

        with open_db() as connection:
            try:
                row = connection.execute(f"SELECT * FROM {table_name} WHERE id = ?", (record_id,)).fetchone()
                if not row:
                    return {"error": "记录不存在"}
                return {"item": dict(row)}
            except sqlite3.OperationalError as error:
                return {"error": str(error)}

    def handle_db_api_post(self, parsed):
        """Handle database admin POST requests."""
        current = get_current_auth(self)
        if not current.get("authenticated") or current.get("user", {}).get("role") != ROLE_SUPERADMIN:
            self.send_json({"error": "只有超级管理员可以访问数据库管理"}, status=HTTPStatus.FORBIDDEN)
            return

        path_parts = parsed.path.strip("/").split("/")

        if len(path_parts) >= 4 and path_parts[2] == "table":
            table_name = unquote(path_parts[3])
            payload = self.read_json()
            self.create_db_record(table_name, payload)
            return

        self.send_json({"error": "无效的数据库 API 路径"}, status=HTTPStatus.BAD_REQUEST)

    def create_db_record(self, table_name, payload):
        try:
            with open_db() as connection:
                columns = [row["name"] for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()]
                insert_columns = [column for column in columns if column != "id"]

                values = []
                params = []
                for column in insert_columns:
                    if column in payload:
                        values.append(column)
                        params.append(payload[column])

                if not values:
                    self.send_json({"error": "没有提供有效的数据"}, status=HTTPStatus.BAD_REQUEST)
                    return

                placeholders = ", ".join(["?" for _ in values])
                sql = f"INSERT INTO {table_name} ({', '.join(values)}) VALUES ({placeholders})"
                cursor = connection.execute(sql, params)
                connection.commit()

                new_id = cursor.lastrowid
                new_row = connection.execute(f"SELECT * FROM {table_name} WHERE id = ?", (new_id,)).fetchone()
                self.send_json({"message": "记录创建成功", "item": dict(new_row)}, status=HTTPStatus.CREATED)
        except sqlite3.OperationalError as error:
            self.send_json({"error": f"创建失败: {str(error)}"}, status=HTTPStatus.BAD_REQUEST)

    def handle_db_api_put(self, parsed):
        """Handle database admin PUT requests."""
        current = get_current_auth(self)
        if not current.get("authenticated") or current.get("user", {}).get("role") != ROLE_SUPERADMIN:
            self.send_json({"error": "只有超级管理员可以访问数据库管理"}, status=HTTPStatus.FORBIDDEN)
            return

        path_parts = parsed.path.strip("/").split("/")

        if len(path_parts) >= 5 and path_parts[2] == "table":
            table_name = unquote(path_parts[3])
            record_id = path_parts[4]
            payload = self.read_json()
            self.update_db_record(table_name, record_id, payload)
            return

        self.send_json({"error": "无效的数据库 API 路径"}, status=HTTPStatus.BAD_REQUEST)

    def update_db_record(self, table_name, record_id, payload):
        if not record_id.isdigit():
            self.send_json({"error": "无效的记录 ID"}, status=HTTPStatus.BAD_REQUEST)
            return

        try:
            with open_db() as connection:
                previous_row = None
                if table_name == "users":
                    previous_row = connection.execute(
                        "SELECT id, role, alliance, league, is_active FROM users WHERE id = ?",
                        (record_id,),
                    ).fetchone()
                    if not previous_row:
                        self.send_json({"error": "记录不存在"}, status=HTTPStatus.NOT_FOUND)
                        return

                columns = [row["name"] for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()]
                update_columns = [column for column in columns if column != "id"]

                set_clauses = []
                params = []
                for column in update_columns:
                    if column in payload:
                        set_clauses.append(f"{column} = ?")
                        params.append(payload[column])

                if not set_clauses:
                    self.send_json({"error": "没有提供有效的数据"}, status=HTTPStatus.BAD_REQUEST)
                    return

                params.append(record_id)
                sql = f"UPDATE {table_name} SET {', '.join(set_clauses)} WHERE id = ?"
                cursor = connection.execute(sql, params)
                connection.commit()

                if cursor.rowcount == 0:
                    self.send_json({"error": "记录不存在"}, status=HTTPStatus.NOT_FOUND)
                    return

                if previous_row:
                    next_role = normalize_role(payload.get("role", previous_row["role"]))
                    next_alliance = str(payload.get("alliance", previous_row["alliance"]) or "").strip()
                    next_league = normalize_league_scope(payload.get("league", previous_row["league"]))
                    next_is_active = int(payload.get("is_active", previous_row["is_active"]))
                    previous_role = normalize_role(previous_row["role"])
                    previous_alliance = str(previous_row["alliance"] or "").strip()
                    previous_league = normalize_league_scope(previous_row["league"])
                    previous_is_active = int(previous_row["is_active"])
                    if (
                        next_role != previous_role
                        or next_alliance != previous_alliance
                        or next_league != previous_league
                        or next_is_active != previous_is_active
                    ):
                        invalidate_user_sessions(int(record_id), False)

                new_row = connection.execute(f"SELECT * FROM {table_name} WHERE id = ?", (record_id,)).fetchone()
                self.send_json({"message": "记录更新成功", "item": dict(new_row)})
        except sqlite3.OperationalError as error:
            self.send_json({"error": f"更新失败: {str(error)}"}, status=HTTPStatus.BAD_REQUEST)

    def handle_db_api_delete(self, parsed):
        """Handle database admin DELETE requests."""
        current = get_current_auth(self)
        if not current.get("authenticated") or current.get("user", {}).get("role") != ROLE_SUPERADMIN:
            self.send_json({"error": "只有超级管理员可以访问数据库管理"}, status=HTTPStatus.FORBIDDEN)
            return

        path_parts = parsed.path.strip("/").split("/")

        if len(path_parts) >= 5 and path_parts[2] == "table":
            table_name = unquote(path_parts[3])
            record_id = path_parts[4]
            self.delete_db_record(table_name, record_id)
            return

        self.send_json({"error": "无效的数据库 API 路径"}, status=HTTPStatus.BAD_REQUEST)

    def delete_db_record(self, table_name, record_id):
        if not record_id.isdigit():
            self.send_json({"error": "无效的记录 ID"}, status=HTTPStatus.BAD_REQUEST)
            return

        try:
            with open_db() as connection:
                cursor = connection.execute(f"DELETE FROM {table_name} WHERE id = ?", (record_id,))
                connection.commit()

                if cursor.rowcount == 0:
                    self.send_json({"error": "记录不存在"}, status=HTTPStatus.NOT_FOUND)
                    return

                self.send_json({"message": "记录删除成功"})
        except sqlite3.OperationalError as error:
            self.send_json({"error": f"删除失败: {str(error)}"}, status=HTTPStatus.BAD_REQUEST)

    def export_db_file(self):
        """Export the database file."""
        if not DB_PATH.exists():
            self.send_json({"error": "数据库文件不存在"}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            data = DB_PATH.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", 'attachment; filename="alliance.db"')
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            self.send_json({"error": f"导出失败: {str(e)}"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
