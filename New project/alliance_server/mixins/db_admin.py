from alliance_server.shared import *

from auth import ROLE_SUPERADMIN, get_current_auth

class DatabaseAdminMixin:
    def handle_db_api(self, parsed):
        """处理数据库管理 API 请求"""
        # 仅限超级管理员
        current = get_current_auth(self)
        if not current.get("authenticated") or current.get("user", {}).get("role") != ROLE_SUPERADMIN:
            self.send_json({"error": "只有超级管理员可以访问数据库管理"}, status=HTTPStatus.FORBIDDEN)
            return
        
        path_parts = parsed.path.strip("/").split("/")
        # path: /api/db/tables 或 /api/db/table/<name> 或 /api/db/table/<name>/<id>
        
        if len(path_parts) >= 3 and path_parts[2] == "tables":
            # 获取所有表列表
            self.send_json(self.list_db_tables())
            return
        
        if len(path_parts) >= 4 and path_parts[2] == "table":
            table_name = unquote(path_parts[3])
            if len(path_parts) == 5:
                # 获取单个记录或表数据
                record_id = path_parts[4]
                self.send_json(self.get_db_table_record(table_name, record_id))
            else:
                # 获取表的所有数据
                self.send_json(self.get_db_table_data(table_name))
            return
        
        self.send_json({"error": "无效的数据库 API 路径"}, status=HTTPStatus.BAD_REQUEST)

    def list_db_tables(self):
        """列出所有数据库表"""
        with open_db() as connection:
            rows = connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            ).fetchall()
        tables = [row["name"] for row in rows]
        return {"tables": tables}

    def get_db_table_data(self, table_name):
        """获取表的所有数据"""
        with open_db() as connection:
            try:
                # 获取表结构
                columns = [row["name"] for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()]
                # 获取数据
                rows = connection.execute(f"SELECT * FROM {table_name} ORDER BY id DESC").fetchall()
                items = [dict(row) for row in rows]
                return {"table": table_name, "columns": columns, "items": items, "count": len(items)}
            except sqlite3.OperationalError as e:
                return {"error": str(e)}

    def get_db_table_record(self, table_name, record_id):
        """获取单条记录"""
        if not record_id.isdigit():
            return {"error": "无效的记录 ID"}
        
        with open_db() as connection:
            try:
                row = connection.execute(f"SELECT * FROM {table_name} WHERE id = ?", (record_id,)).fetchone()
                if not row:
                    return {"error": "记录不存在"}
                return {"item": dict(row)}
            except sqlite3.OperationalError as e:
                return {"error": str(e)}

    def handle_db_api_post(self, parsed):
        """处理数据库管理 POST 请求（新增记录）"""
        current = get_current_auth(self)
        if not current.get("authenticated") or current.get("user", {}).get("role") != ROLE_SUPERADMIN:
            self.send_json({"error": "只有超级管理员可以访问数据库管理"}, status=HTTPStatus.FORBIDDEN)
            return
        
        path_parts = parsed.path.strip("/").split("/")
        # path: /api/db/table/<name>
        
        if len(path_parts) >= 4 and path_parts[2] == "table":
            table_name = unquote(path_parts[3])
            payload = self.read_json()
            self.create_db_record(table_name, payload)
            return
        
        self.send_json({"error": "无效的数据库 API 路径"}, status=HTTPStatus.BAD_REQUEST)

    def create_db_record(self, table_name, payload):
        """在指定表中创建新记录"""
        try:
            with open_db() as connection:
                # 获取表结构
                columns = [row["name"] for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()]
                # 过滤掉 id 和 auto 字段
                insert_columns = [c for c in columns if c != "id"]
                
                # 构建插入语句
                values = []
                params = []
                for col in insert_columns:
                    if col in payload:
                        values.append(col)
                        params.append(payload[col])
                
                if not values:
                    self.send_json({"error": "没有提供有效的数据"}, status=HTTPStatus.BAD_REQUEST)
                    return
                
                placeholders = ", ".join(["?" for _ in values])
                sql = f"INSERT INTO {table_name} ({', '.join(values)}) VALUES ({placeholders})"
                cursor = connection.execute(sql, params)
                connection.commit()
                
                # 获取新创建的记录
                new_id = cursor.lastrowid
                new_row = connection.execute(f"SELECT * FROM {table_name} WHERE id = ?", (new_id,)).fetchone()
                
                self.send_json({"message": "记录创建成功", "item": dict(new_row)}, status=HTTPStatus.CREATED)
        except sqlite3.OperationalError as e:
            self.send_json({"error": f"创建失败: {str(e)}"}, status=HTTPStatus.BAD_REQUEST)

    def handle_db_api_put(self, parsed):
        """处理数据库管理 PUT 请求（更新记录）"""
        current = get_current_auth(self)
        if not current.get("authenticated") or current.get("user", {}).get("role") != ROLE_SUPERADMIN:
            self.send_json({"error": "只有超级管理员可以访问数据库管理"}, status=HTTPStatus.FORBIDDEN)
            return
        
        path_parts = parsed.path.strip("/").split("/")
        # path: /api/db/table/<name>/<id>
        
        if len(path_parts) >= 5 and path_parts[2] == "table":
            table_name = unquote(path_parts[3])
            record_id = path_parts[4]
            payload = self.read_json()
            self.update_db_record(table_name, record_id, payload)
            return
        
        self.send_json({"error": "无效的数据库 API 路径"}, status=HTTPStatus.BAD_REQUEST)

    def update_db_record(self, table_name, record_id, payload):
        """更新指定表的记录"""
        if not record_id.isdigit():
            self.send_json({"error": "无效的记录 ID"}, status=HTTPStatus.BAD_REQUEST)
            return
        
        try:
            with open_db() as connection:
                # 获取表结构
                columns = [row["name"] for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()]
                # 过滤掉 id 和 auto 字段
                update_columns = [c for c in columns if c != "id"]
                
                # 构建更新语句
                set_clauses = []
                params = []
                for col in update_columns:
                    if col in payload:
                        set_clauses.append(f"{col} = ?")
                        params.append(payload[col])
                
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
                
                # 获取更新后的记录
                new_row = connection.execute(f"SELECT * FROM {table_name} WHERE id = ?", (record_id,)).fetchone()
                
                self.send_json({"message": "记录更新成功", "item": dict(new_row)})
        except sqlite3.OperationalError as e:
            self.send_json({"error": f"更新失败: {str(e)}"}, status=HTTPStatus.BAD_REQUEST)

    def handle_db_api_delete(self, parsed):
        """处理数据库管理 DELETE 请求（删除记录）"""
        current = get_current_auth(self)
        if not current.get("authenticated") or current.get("user", {}).get("role") != ROLE_SUPERADMIN:
            self.send_json({"error": "只有超级管理员可以访问数据库管理"}, status=HTTPStatus.FORBIDDEN)
            return
        
        path_parts = parsed.path.strip("/").split("/")
        # path: /api/db/table/<name>/<id>
        
        if len(path_parts) >= 5 and path_parts[2] == "table":
            table_name = unquote(path_parts[3])
            record_id = path_parts[4]
            self.delete_db_record(table_name, record_id)
            return
        
        self.send_json({"error": "无效的数据库 API 路径"}, status=HTTPStatus.BAD_REQUEST)

    def delete_db_record(self, table_name, record_id):
        """删除指定表的记录"""
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
        except sqlite3.OperationalError as e:
            self.send_json({"error": f"删除失败: {str(e)}"}, status=HTTPStatus.BAD_REQUEST)
