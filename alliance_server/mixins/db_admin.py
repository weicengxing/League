from alliance_server.shared import *

from auth import (
    ROLE_SUPERADMIN,
    get_current_auth,
    invalidate_user_sessions,
    normalize_league_scope,
    normalize_role,
)


class DatabaseAdminMixin:
    _uploads_export_lock = threading.Lock()

    def ensure_db_admin_access(self):
        current = get_current_auth(self)
        if not current.get("authenticated") or current.get("user", {}).get("role") != ROLE_SUPERADMIN:
            self.send_json({"error": "只有 SuperAdmin 可以访问数据库管理"}, status=HTTPStatus.FORBIDDEN)
            return False
        return True

    def get_allowed_db_tables(self, connection):
        rows = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        return [row["name"] for row in rows if row["name"] != "admins"]

    def validate_db_table_name(self, connection, table_name):
        if table_name not in set(self.get_allowed_db_tables(connection)):
            raise ValueError("数据表不存在")
        return table_name

    def quote_db_identifier(self, value):
        return f'"{str(value).replace(chr(34), chr(34) * 2)}"'

    def handle_db_api(self, parsed):
        """Handle database admin GET requests."""
        if not self.ensure_db_admin_access():
            return

        path_parts = parsed.path.strip("/").split("/")

        if len(path_parts) >= 4 and path_parts[2] == "uploads" and path_parts[3] == "export":
            self.export_uploads_archive()
            return

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
            return {"tables": self.get_allowed_db_tables(connection)}

    def get_db_table_data(self, table_name):
        with open_db() as connection:
            try:
                safe_table_name = self.validate_db_table_name(connection, table_name)
                quoted_table_name = self.quote_db_identifier(safe_table_name)
                columns = [row["name"] for row in connection.execute(f"PRAGMA table_info({quoted_table_name})").fetchall()]
                rows = connection.execute(f"SELECT * FROM {quoted_table_name} ORDER BY id DESC").fetchall()
                items = [dict(row) for row in rows]
                return {"table": safe_table_name, "columns": columns, "items": items, "count": len(items)}
            except ValueError as error:
                return {"error": str(error)}
            except sqlite3.OperationalError as error:
                return {"error": str(error)}

    def get_db_table_record(self, table_name, record_id):
        if not record_id.isdigit():
            return {"error": "无效的记录 ID"}

        with open_db() as connection:
            try:
                safe_table_name = self.validate_db_table_name(connection, table_name)
                quoted_table_name = self.quote_db_identifier(safe_table_name)
                row = connection.execute(f"SELECT * FROM {quoted_table_name} WHERE id = ?", (record_id,)).fetchone()
                if not row:
                    return {"error": "记录不存在"}
                return {"item": dict(row)}
            except ValueError as error:
                return {"error": str(error)}
            except sqlite3.OperationalError as error:
                return {"error": str(error)}

    def handle_db_api_post(self, parsed):
        """Handle database admin POST requests."""
        if not self.ensure_db_admin_access():
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
                safe_table_name = self.validate_db_table_name(connection, table_name)
                quoted_table_name = self.quote_db_identifier(safe_table_name)
                columns = [row["name"] for row in connection.execute(f"PRAGMA table_info({quoted_table_name})").fetchall()]
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
                quoted_columns = ", ".join(self.quote_db_identifier(column) for column in values)
                sql = f"INSERT INTO {quoted_table_name} ({quoted_columns}) VALUES ({placeholders})"
                cursor = connection.execute(sql, params)
                connection.commit()

                new_id = cursor.lastrowid
                new_row = connection.execute(f"SELECT * FROM {quoted_table_name} WHERE id = ?", (new_id,)).fetchone()
                self.send_json({"message": "记录创建成功", "item": dict(new_row)}, status=HTTPStatus.CREATED)
        except ValueError as error:
            self.send_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        except sqlite3.OperationalError as error:
            self.send_json({"error": f"创建失败: {error}"}, status=HTTPStatus.BAD_REQUEST)

    def handle_db_api_put(self, parsed):
        """Handle database admin PUT requests."""
        if not self.ensure_db_admin_access():
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
                safe_table_name = self.validate_db_table_name(connection, table_name)
                quoted_table_name = self.quote_db_identifier(safe_table_name)
                previous_row = None
                if safe_table_name == "users":
                    previous_row = connection.execute(
                        "SELECT id, role, alliance, league, is_active FROM users WHERE id = ?",
                        (record_id,),
                    ).fetchone()
                    if not previous_row:
                        self.send_json({"error": "记录不存在"}, status=HTTPStatus.NOT_FOUND)
                        return

                columns = [row["name"] for row in connection.execute(f"PRAGMA table_info({quoted_table_name})").fetchall()]
                update_columns = [column for column in columns if column != "id"]

                set_clauses = []
                params = []
                for column in update_columns:
                    if column in payload:
                        set_clauses.append(f"{self.quote_db_identifier(column)} = ?")
                        params.append(payload[column])

                if not set_clauses:
                    self.send_json({"error": "没有提供有效的数据"}, status=HTTPStatus.BAD_REQUEST)
                    return

                params.append(record_id)
                sql = f"UPDATE {quoted_table_name} SET {', '.join(set_clauses)} WHERE id = ?"
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

                new_row = connection.execute(f"SELECT * FROM {quoted_table_name} WHERE id = ?", (record_id,)).fetchone()
                self.send_json({"message": "记录更新成功", "item": dict(new_row)})
        except ValueError as error:
            self.send_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        except sqlite3.OperationalError as error:
            self.send_json({"error": f"更新失败: {error}"}, status=HTTPStatus.BAD_REQUEST)

    def handle_db_api_delete(self, parsed):
        """Handle database admin DELETE requests."""
        if not self.ensure_db_admin_access():
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
                safe_table_name = self.validate_db_table_name(connection, table_name)
                quoted_table_name = self.quote_db_identifier(safe_table_name)
                cursor = connection.execute(f"DELETE FROM {quoted_table_name} WHERE id = ?", (record_id,))
                connection.commit()

                if cursor.rowcount == 0:
                    self.send_json({"error": "记录不存在"}, status=HTTPStatus.NOT_FOUND)
                    return

                self.send_json({"message": "记录删除成功"})
        except ValueError as error:
            self.send_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
        except sqlite3.OperationalError as error:
            self.send_json({"error": f"删除失败: {error}"}, status=HTTPStatus.BAD_REQUEST)

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
        except Exception as error:
            self.send_json({"error": f"导出失败: {error}"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def export_uploads_archive(self):
        uploads_root = PUBLIC_DIR / "uploads"
        if not uploads_root.exists():
            self.send_json({"error": "uploads 文件夹不存在"}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            archive_path = self.build_uploads_archive(uploads_root)
            self.send_file_with_range_support(
                archive_path,
                content_type="application/zip",
                download_name="uploads-export.zip",
            )
        except Exception as error:
            self.send_json({"error": f"导出图片压缩包失败: {error}"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def build_uploads_archive(self, uploads_root):
        export_dir = DATA_DIR / "tmp" / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        archive_path = export_dir / "uploads-export.zip"
        manifest_path = export_dir / "uploads-export-manifest.json"
        current_manifest = self.collect_uploads_manifest(uploads_root)

        with self._uploads_export_lock:
            cached_manifest = None
            if archive_path.exists() and manifest_path.exists():
                try:
                    cached_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    cached_manifest = None

            if cached_manifest == current_manifest and archive_path.exists():
                return archive_path

            temp_archive_path = export_dir / f"uploads-export-{os.getpid()}.tmp"
            if temp_archive_path.exists():
                temp_archive_path.unlink()

            import zipfile

            with zipfile.ZipFile(temp_archive_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                archive.writestr("uploads/", b"")
                for relative_path in current_manifest["files"]:
                    source_path = uploads_root / relative_path
                    archive.write(source_path, Path("uploads") / relative_path)

            temp_archive_path.replace(archive_path)
            manifest_path.write_text(
                json.dumps(current_manifest, ensure_ascii=False, separators=(",", ":")),
                encoding="utf-8",
            )
        return archive_path

    def collect_uploads_manifest(self, uploads_root):
        files = []
        signature_items = []
        for path in sorted(uploads_root.rglob("*")):
            if not path.is_file():
                continue
            relative_path = path.relative_to(uploads_root).as_posix()
            stat = path.stat()
            files.append(relative_path)
            signature_items.append({
                "path": relative_path,
                "size": stat.st_size,
                "mtime_ns": stat.st_mtime_ns,
            })
        return {"root": "uploads", "files": files, "signature": signature_items}

    def send_file_with_range_support(self, file_path, content_type, download_name):
        file_size = file_path.stat().st_size
        range_header = (self.headers.get("Range") or "").strip()
        start = 0
        end = file_size - 1
        status = HTTPStatus.OK

        if range_header:
            parsed_range = self.parse_http_range(range_header, file_size)
            if parsed_range is None:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
                return
            start, end = parsed_range
            status = HTTPStatus.PARTIAL_CONTENT

        content_length = max(0, end - start + 1)
        stat = file_path.stat()
        etag = f'W/"{stat.st_mtime_ns:x}-{file_size:x}"'

        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Disposition", f'attachment; filename="{download_name}"')
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("ETag", etag)
        self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
        self.send_header("Content-Length", str(content_length))
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.end_headers()

        with file_path.open("rb") as handle:
            handle.seek(start)
            remaining = content_length
            while remaining > 0:
                chunk = handle.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def parse_http_range(self, range_header, file_size):
        if not range_header.startswith("bytes="):
            return None

        value = range_header[6:].strip()
        if "," in value:
            return None

        start_text, sep, end_text = value.partition("-")
        if not sep:
            return None

        try:
            if start_text == "":
                suffix_length = int(end_text)
                if suffix_length <= 0:
                    return None
                start = max(file_size - suffix_length, 0)
                end = file_size - 1
            else:
                start = int(start_text)
                end = file_size - 1 if end_text == "" else int(end_text)
        except ValueError:
            return None

        if file_size <= 0 or start < 0 or end < start or start >= file_size:
            return None

        end = min(end, file_size - 1)
        return start, end
