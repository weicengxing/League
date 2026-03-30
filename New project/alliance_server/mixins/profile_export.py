from alliance_server.shared import *

from auth import get_current_auth

class ProfileExportMixin:
    def import_members_from_excel(self):
        """从Excel文件导入成员数据"""
        form = parse_form_data(self)
        
        # 获取Excel文件
        file_item = form.get("file") if hasattr(form, 'get') else form.get("file") if isinstance(form, dict) else None
        if file_item is None or getattr(file_item, "file", None) is None:
            self.send_json({"error": "请先选择Excel文件"}, status=HTTPStatus.BAD_REQUEST)
            return
        
        # 获取目标妖盟信息
        guild_code = str(form.getvalue("guild_code", "")).strip()
        guild_prefix = str(form.getvalue("guild_prefix", "")).strip()
        guild_name = str(form.getvalue("guild", "")).strip()
        
        if not guild_name:
            self.send_json({"error": "缺少妖盟信息"}, status=HTTPStatus.BAD_REQUEST)
            return
        
        # 读取文件内容
        raw = file_item.file.read()
        if not raw:
            self.send_json({"error": "Excel文件不能为空"}, status=HTTPStatus.BAD_REQUEST)
            return
        
        # 保存临时文件
        import tempfile
        import os
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name
        
        try:
            # 解析Excel
            wb = openpyxl.load_workbook(tmp_path)
            ws = wb.active
            
            # 获取表头行（第一行）
            headers = []
            for cell in ws[1]:
                headers.append(str(cell.value).strip() if cell.value else "")
            
            # 找到各列的索引（列顺序不固定）
            col_indices = {}
            for i, header in enumerate(headers):
                header_lower = header.lower()
                if header_lower in ["名称", "昵称", "name"]:
                    col_indices["name"] = i
                elif header_lower in ["境界", "realm"]:
                    col_indices["realm"] = i
                elif header_lower in ["等级", "level", "lv", "role"]:
                    col_indices["role"] = i
                elif header_lower in ["敏捷", "speed"]:
                    col_indices["speed"] = i
                elif header_lower in ["战力", "power"]:
                    col_indices["power"] = i
                elif header_lower in ["灵兽", "宠物", "pet"]:
                    col_indices["pet"] = i
                elif header_lower in ["增伤", "bonus_damage", "bonus"]:
                    col_indices["bonus_damage"] = i
                elif header_lower in ["减伤", "damage_reduction", "reduction"]:
                    col_indices["damage_reduction"] = i
            
            if "name" not in col_indices:
                self.send_json({"error": "Excel中未找到成员名称列（名称/昵称）"}, status=HTTPStatus.BAD_REQUEST)
                return
            
            # 解析数据行
            rows_data = []
            for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
                name = str(row[col_indices["name"]]).strip() if col_indices["name"] < len(row) and row[col_indices["name"]] else ""
                if not name:
                    continue
                
                row_data = {
                    "name": name,
                    "realm": str(row[col_indices["realm"]]).strip() if "realm" in col_indices and col_indices["realm"] < len(row) and row[col_indices["realm"]] else "待补充",
                    "role": str(row[col_indices["role"]]).strip() if "role" in col_indices and col_indices["role"] < len(row) and row[col_indices["role"]] else "成员",
                    "speed": row[col_indices["speed"]] if "speed" in col_indices and col_indices["speed"] < len(row) else 0,
                    "power": row[col_indices["power"]] if "power" in col_indices and col_indices["power"] < len(row) else 0,
                    "pet": str(row[col_indices["pet"]]).strip() if "pet" in col_indices and col_indices["pet"] < len(row) and row[col_indices["pet"]] else "待补充",
                    "bonus_damage": row[col_indices["bonus_damage"]] if "bonus_damage" in col_indices and col_indices["bonus_damage"] < len(row) else 0,
                    "damage_reduction": row[col_indices["damage_reduction"]] if "damage_reduction" in col_indices and col_indices["damage_reduction"] < len(row) else 0,
                }
                rows_data.append(row_data)
            
            if not rows_data:
                self.send_json({"error": "Excel中没有找到有效数据"}, status=HTTPStatus.BAD_REQUEST)
                return
            
            # Excel内部去重（按名称）
            seen_names = set()
            unique_rows = []
            for row_data in rows_data:
                if row_data["name"] not in seen_names:
                    seen_names.add(row_data["name"])
                    unique_rows.append(row_data)
            
            excel_duplicates = len(rows_data) - len(unique_rows)
            
            # 获取数据库中该妖盟已有的成员名称
            with open_db() as connection:
                existing_members = connection.execute(
                    "SELECT name FROM members WHERE guild_code = ? AND guild_prefix = ? AND guild = ?",
                    (guild_code, guild_prefix, guild_name)
                ).fetchall()
                existing_names = set(row["name"] for row in existing_members)
                
                # 检查妖盟是否存在
                guild = connection.execute(
                    "SELECT * FROM guild_registry WHERE guild_code = ? AND guild_prefix = ? AND guild = ?",
                    (guild_code, guild_prefix, guild_name)
                ).fetchone()
                
                if not guild:
                    self.send_json({"error": f"妖盟 '{guild_name}' 不存在，请先创建妖盟"}, status=HTTPStatus.BAD_REQUEST)
                    return
                
                alliance = guild["alliance"]
                hill = guild["hill"]
                current = get_current_auth(self)
                user = current.get("user") or {}
                if not current.get("authenticated") or not self.can_access_alliance(user, alliance, "manage_members"):
                    self.send_json({"error": "当前账号没有导入该联盟成员的权限"}, status=HTTPStatus.FORBIDDEN)
                    return
                
                # 过滤掉已存在的成员
                new_members = [row for row in unique_rows if row["name"] not in existing_names]
                db_duplicates = len(unique_rows) - len(new_members)
                
                if not new_members:
                    self.send_json({
                        "message": "所有成员均已存在，无需导入",
                        "imported": 0,
                        "skipped_excel_duplicates": excel_duplicates,
                        "skipped_existing": db_duplicates,
                        "total_rows": len(rows_data)
                    })
                    return
                
                # 插入新成员
                timestamp = now_text()
                imported_count = 0
                for row_data in new_members:
                    try:
                        power = parse_scaled_number(row_data["power"], "战力")
                        speed = parse_scaled_number(row_data["speed"], "敏捷")
                        bonus_damage = parse_scaled_number(row_data["bonus_damage"], "增伤")
                        damage_reduction = parse_scaled_number(row_data["damage_reduction"], "减伤")
                    except (TypeError, ValueError):
                        power = 0
                        speed = 0
                        bonus_damage = 0
                        damage_reduction = 0
                    
                    connection.execute(
                        """
                        INSERT INTO members (
                            alliance, hill, guild_code, guild_prefix, guild_power, guild, name, role, realm, power, hp, attack, defense, speed, bonus_damage, damage_reduction, pet, note, screenshot_path, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            alliance, hill, guild_code, guild_prefix, 0, guild_name,
                            row_data["name"], row_data["role"], row_data["realm"], power,
                            0, 0, 0, speed, bonus_damage, damage_reduction,
                            row_data["pet"], "", "", timestamp, timestamp
                        )
                    )
                    imported_count += 1
                
                connection.commit()
            
            self.send_json({
                "message": f"成功导入 {imported_count} 名成员",
                "imported": imported_count,
                "skipped_excel_duplicates": excel_duplicates,
                "skipped_existing": db_duplicates,
                "total_rows": len(rows_data)
            })
            
        except Exception as exc:
            self.send_json({"error": f"解析Excel文件失败: {str(exc)}"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
        finally:
            # 删除临时文件
            try:
                os.unlink(tmp_path)
            except:
                pass

    def import_guilds_from_excel(self):
        """从Excel文件批量导入妖盟数据"""
        form = parse_form_data(self)

        file_item = form.get("file") if hasattr(form, 'get') else form.get("file") if isinstance(form, dict) else None
        if file_item is None or getattr(file_item, "file", None) is None:
            self.send_json({"error": "请先选择Excel文件"}, status=HTTPStatus.BAD_REQUEST)
            return

        default_alliance = str(form.getvalue("alliance", "")).strip() or "🔮联盟"

        raw = file_item.file.read()
        if not raw:
            self.send_json({"error": "Excel文件不能为空"}, status=HTTPStatus.BAD_REQUEST)
            return

        import tempfile
        import os

        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            tmp.write(raw)
            tmp_path = tmp.name

        try:
            wb = openpyxl.load_workbook(tmp_path)
            ws = wb.active

            headers = [str(cell.value).strip() if cell.value else "" for cell in ws[1]]
            col_indices = {}
            for i, header in enumerate(headers):
                header_lower = header.lower()
                if header_lower in ["妖盟编号", "编号", "guild_code", "code"]:
                    col_indices["guild_code"] = i
                elif header_lower in ["山名字号", "山头", "前缀", "guild_prefix", "prefix"]:
                    col_indices["guild_prefix"] = i
                elif header_lower in ["妖盟名称", "妖盟", "guild", "name"]:
                    col_indices["guild"] = i
                elif header_lower in ["妖盟总战力", "总战力", "guild_power", "power"]:
                    col_indices["guild_power"] = i
                elif header_lower in ["盟主昵称", "盟主", "leader_name", "leader"]:
                    col_indices["leader_name"] = i

            if "guild" not in col_indices:
                self.send_json({"error": "Excel中未找到妖盟名称列（妖盟名称/妖盟）"}, status=HTTPStatus.BAD_REQUEST)
                return

            rows_data = []
            for row in ws.iter_rows(min_row=2, values_only=True):
                guild_name = str(row[col_indices["guild"]]).strip() if col_indices["guild"] < len(row) and row[col_indices["guild"]] else ""
                if not guild_name:
                    continue

                row_data = {
                    "alliance": default_alliance,
                    "guild_code": str(row[col_indices["guild_code"]]).strip() if "guild_code" in col_indices and col_indices["guild_code"] < len(row) and row[col_indices["guild_code"]] else "",
                    "guild_prefix": str(row[col_indices["guild_prefix"]]).strip() if "guild_prefix" in col_indices and col_indices["guild_prefix"] < len(row) and row[col_indices["guild_prefix"]] else "",
                    "guild": guild_name,
                    "guild_power": row[col_indices["guild_power"]] if "guild_power" in col_indices and col_indices["guild_power"] < len(row) else 0,
                    "leader_name": str(row[col_indices["leader_name"]]).strip() if "leader_name" in col_indices and col_indices["leader_name"] < len(row) and row[col_indices["leader_name"]] else "",
                }
                rows_data.append(row_data)

            if not rows_data:
                self.send_json({"error": "Excel中没有找到有效妖盟数据"}, status=HTTPStatus.BAD_REQUEST)
                return

            seen_keys = set()
            unique_rows = []
            for row_data in rows_data:
                unique_key = build_guild_key(row_data["guild_code"], row_data["guild_prefix"], row_data["guild"])
                if unique_key in seen_keys:
                    continue
                seen_keys.add(unique_key)
                unique_rows.append(row_data)

            excel_duplicates = len(rows_data) - len(unique_rows)

            with open_db() as connection:
                existing_rows = connection.execute("SELECT guild_key FROM guild_registry").fetchall()
                existing_keys = {row["guild_key"] for row in existing_rows}

                new_guilds = []
                skipped_existing = 0
                for row_data in unique_rows:
                    try:
                        guild = validate_guild(row_data)
                    except ValueError:
                        continue
                    guild_key = build_guild_key(guild["guild_code"], guild["guild_prefix"], guild["guild"])
                    if guild_key in existing_keys:
                        skipped_existing += 1
                        continue
                    new_guilds.append((guild_key, guild))
                    existing_keys.add(guild_key)

                if not new_guilds:
                    self.send_json({
                        "message": "所有妖盟均已存在，无需导入",
                        "imported": 0,
                        "skipped_excel_duplicates": excel_duplicates,
                        "skipped_existing": skipped_existing,
                        "total_rows": len(rows_data),
                    })
                    return

                timestamp = now_text()
                for guild_key, guild in new_guilds:
                    connection.execute(
                        """
                        INSERT INTO guild_registry (
                            guild_key, alliance, hill, guild_code, guild_prefix, guild, guild_power, leader_name, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            guild_key,
                            guild["alliance"],
                            guild["hill"],
                            guild["guild_code"],
                            guild["guild_prefix"],
                            guild["guild"],
                            guild["guild_power"],
                            guild["leader_name"],
                            timestamp,
                        ),
                    )
                connection.commit()

            self.send_json({
                "message": f"成功导入 {len(new_guilds)} 个妖盟",
                "imported": len(new_guilds),
                "skipped_excel_duplicates": excel_duplicates,
                "skipped_existing": skipped_existing,
                "total_rows": len(rows_data),
            })

        except Exception as exc:
            self.send_json({"error": f"解析Excel文件失败: {str(exc)}"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
        finally:
            try:
                os.unlink(tmp_path)
            except:
                pass

    def get_current_user_profile(self):
        current = get_current_auth(self)
        if not current.get("authenticated"):
            return {"authenticated": False, "account": None, "member": None, "linked": False, "is_admin": False}
        if current.get("is_admin"):
            return {
                "authenticated": True,
                "account": current["user"],
                "member": None,
                "linked": False,
                "is_admin": True,
            }

        member = self.fetch_member_for_user(current["user"]["id"])
        return {
            "authenticated": True,
            "account": current["user"],
            "member": member,
            "linked": bool(member),
            "is_admin": False,
            "auto_link_hint": "用户名与成员昵称完全一致时，系统会自动关联成员档案。",
        }

    def get_current_user_avatar(self):
        current = get_current_auth(self)
        if not current.get("authenticated") or current.get("is_admin"):
            return {
                "authenticated": bool(current.get("authenticated")),
                "avatar_url": "",
                "is_admin": bool(current.get("is_admin")),
            }
        return {
            "authenticated": True,
            "avatar_url": current.get("user", {}).get("avatar_url", ""),
            "is_admin": False,
        }

    def fetch_member_for_user(self, user_id):
        with open_db() as connection:
            row = connection.execute(
                """
                SELECT m.*
                FROM users u
                LEFT JOIN members m ON m.id = COALESCE(u.member_id, u.member)
                WHERE u.id = ?
                """,
                (user_id,),
            ).fetchone()
        if not row or row["id"] is None:
            return None
        return serialize_member(dict(row))

    def update_current_user_profile(self, user, payload):
        member = self.fetch_member_for_user(user["id"])
        if not member:
            self.send_json({"error": "当前账号还没有关联成员档案，请先联系管理员确认，或使用与成员昵称一致的账号登录"}, status=HTTPStatus.BAD_REQUEST)
            return

        try:
            name = str(payload.get("name", member["name"])).strip() or member["name"]
            role = str(payload.get("role", member["role"])).strip() or member["role"]
            realm = str(payload.get("realm", member["realm"])).strip() or member["realm"]
            power = parse_scaled_number(payload.get("power", member["power"]), "战力")
            hp = parse_scaled_number(payload.get("hp", member["hp"]), "气血")
            attack = parse_scaled_number(payload.get("attack", member["attack"]), "攻击")
            defense = parse_scaled_number(payload.get("defense", member["defense"]), "防御")
            speed = parse_scaled_number(payload.get("speed", member["speed"]), "敏捷")
            bonus_damage = parse_scaled_number(payload.get("bonus_damage", member["bonus_damage"]), "增伤")
            damage_reduction = parse_scaled_number(payload.get("damage_reduction", member["damage_reduction"]), "减伤")
            pet = str(payload.get("pet", member["pet"])).strip() or member["pet"]
            note = str(payload.get("note", member["note"])).strip()
        except (TypeError, ValueError):
            self.send_json({"error": "个人信息里的数值格式不正确"}, status=HTTPStatus.BAD_REQUEST)
            return

        timestamp = now_text()
        with open_db() as connection:
            connection.execute(
                """
                UPDATE members
                SET name = ?, role = ?, realm = ?, power = ?, hp = ?, attack = ?, defense = ?, speed = ?, bonus_damage = ?, damage_reduction = ?, pet = ?, note = ?, updated_at = ?
                WHERE id = ?
                """,
                (name, role, realm, power, hp, attack, defense, speed, bonus_damage, damage_reduction, pet, note, timestamp, member["id"]),
            )
            connection.commit()

        self.send_json({"message": "个人信息更新成功", "item": self.fetch_member_for_user(user["id"])})

    def upload_current_user_screenshot(self, user):
        member = self.fetch_member_for_user(user["id"])
        if not member:
            self.send_json({"error": "当前账号还没有关联成员档案，暂时无法上传截图"}, status=HTTPStatus.BAD_REQUEST)
            return
        self.upload_member_screenshot(str(member["id"]))

    def delete_current_user_screenshot(self, user):
        member = self.fetch_member_for_user(user["id"])
        if not member:
            self.send_json({"error": "当前账号还没有关联成员档案，暂时无法删除截图"}, status=HTTPStatus.BAD_REQUEST)
            return
        self.delete_member_screenshot(str(member["id"]))

    def upload_current_user_avatar(self, user):
        form = parse_form_data(self)
        file_item = form.get("avatar") if hasattr(form, "get") else form.get("avatar") if isinstance(form, dict) else None
        if file_item is None or getattr(file_item, "file", None) is None:
            self.send_json({"error": "请先选择头像文件"}, status=HTTPStatus.BAD_REQUEST)
            return

        raw = file_item.file.read()
        if not raw:
            self.send_json({"error": "头像文件不能为空"}, status=HTTPStatus.BAD_REQUEST)
            return

        filename = getattr(file_item, "filename", "") or "avatar.png"
        suffix = Path(filename).suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".webp", ".gif"}:
            self.send_json({"error": "头像仅支持 png/jpg/jpeg/webp/gif"}, status=HTTPStatus.BAD_REQUEST)
            return

        with open_db() as connection:
            row = connection.execute("SELECT avatar_path FROM users WHERE id = ?", (user["id"],)).fetchone()
        if row and row["avatar_path"]:
            self.delete_current_user_avatar_file(row["avatar_path"])

        version_token = datetime.now().strftime("%Y%m%d%H%M%S")
        relative_path = f"/uploads/avatars/user-{user['id']}-{version_token}{suffix}"
        target_path = PUBLIC_DIR / relative_path.lstrip("/")
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(raw)

        with open_db() as connection:
            connection.execute("UPDATE users SET avatar_path = ? WHERE id = ?", (relative_path, user["id"]))
            connection.commit()

        update_user_sessions_for_user(user["id"], avatar_url=relative_path)
        self.send_json({"message": "头像上传成功", "avatar_url": relative_path})

    def delete_current_user_avatar(self, user):
        with open_db() as connection:
            row = connection.execute("SELECT avatar_path FROM users WHERE id = ?", (user["id"],)).fetchone()
        if not row or not row["avatar_path"]:
            self.send_json({"error": "当前还没有上传头像"}, status=HTTPStatus.BAD_REQUEST)
            return
        self.delete_current_user_avatar_file(row["avatar_path"])
        with open_db() as connection:
            connection.execute("UPDATE users SET avatar_path = '' WHERE id = ?", (user["id"],))
            connection.commit()
        update_user_sessions_for_user(user["id"], avatar_url="")
        self.send_json({"message": "头像已删除", "avatar_url": ""})

    def delete_current_user_avatar_file(self, avatar_path):
        if not avatar_path:
            return
        target = PUBLIC_DIR / str(avatar_path).lstrip("/")
        try:
            resolved = target.resolve()
            avatars_root = AVATAR_UPLOADS_DIR.resolve()
            if str(resolved).startswith(str(avatars_root)) and resolved.exists():
                resolved.unlink()
        except FileNotFoundError:
            return

    def delete_by_id(self, table_name, record_id):
        if not record_id.isdigit():
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        if table_name == "members":
            with open_db() as connection:
                row = connection.execute("SELECT screenshot_path FROM members WHERE id = ?", (record_id,)).fetchone()
            if row and row["screenshot_path"]:
                self.delete_member_screenshot_file(row["screenshot_path"])
        with open_db() as connection:
            cursor = connection.execute(f"DELETE FROM {table_name} WHERE id = ?", (record_id,))
            connection.commit()
        if cursor.rowcount == 0:
            self.send_json({"error": "数据不存在"}, status=HTTPStatus.NOT_FOUND)
            return
        self.send_json({"message": "删除成功"})

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json({"error": "JSON 格式不正确"}, status=HTTPStatus.BAD_REQUEST)
            raise

    def require_admin(self):
        current = get_current_auth(self)
        if not current.get("authenticated") or not current.get("is_admin"):
            self.send_json({"error": "请先登录管理员账号"}, status=HTTPStatus.UNAUTHORIZED)
            return None
        return current["user"]

    def has_permission(self, user, permission):
        if not user:
            return False
        if user.get("role") == ROLE_SUPERADMIN or user.get("is_admin"):
            return True
        return permission in set(user.get("permissions") or [])

    def can_access_alliance(self, user, alliance_name, permission):
        if not self.has_permission(user, permission):
            return False
        if user.get("role") == ROLE_SUPERADMIN or user.get("is_admin"):
            return True
        with open_db() as connection:
            return self.scope_matches_user_league(connection, user, alliance_name)

    def require_permission(self, permission, alliance_name=None, allow_admin_account=True):
        current = get_current_auth(self)
        if not current.get("authenticated"):
            self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
            return None
        user = current.get("user") or {}
        if not allow_admin_account and current.get("is_admin"):
            self.send_json({"error": "当前账号不能执行该操作"}, status=HTTPStatus.FORBIDDEN)
            return None
        allowed = self.has_permission(user, permission) if alliance_name is None else self.can_access_alliance(user, alliance_name, permission)
        if not allowed:
            self.send_json({"error": "当前账号没有执行该操作的权限"}, status=HTTPStatus.FORBIDDEN)
            return None
        return user

    def require_normal_user(self):
        current = get_current_auth(self)
        if not current.get("authenticated"):
            self.send_json({"error": "请先登录普通用户账号"}, status=HTTPStatus.UNAUTHORIZED)
            return None
        if current.get("is_admin"):
            self.send_json({"error": "管理员请使用管理员功能页面"}, status=HTTPStatus.FORBIDDEN)
            return None
        return current["user"]

    def get_current_admin(self):
        current = get_current_auth(self)
        if not current.get("authenticated") or not current.get("is_admin"):
            return None
        return current["user"]

    def get_current_user_or_admin(self):
        """Get current user whether admin or normal user."""
        current = get_current_auth(self)
        if not current.get("authenticated"):
            return None
        return current["user"]

    def get_guild_registry_item(self, guild_key):
        with open_db() as connection:
            row = connection.execute("SELECT * FROM guild_registry WHERE guild_key = ?", (guild_key,)).fetchone()
        return dict(row) if row else None

    def get_member_item(self, member_id):
        if not str(member_id).isdigit():
            return None
        with open_db() as connection:
            row = connection.execute("SELECT * FROM members WHERE id = ?", (int(member_id),)).fetchone()
        return dict(row) if row else None

    def read_session_token(self):
        cookie_header = self.headers.get("Cookie")
        if not cookie_header:
            return None
        cookie = SimpleCookie()
        cookie.load(cookie_header)
        morsel = cookie.get(SESSION_COOKIE)
        return morsel.value if morsel else None

    def delete_member_screenshot_file(self, screenshot_path):
        if not screenshot_path:
            return
        target = PUBLIC_DIR / str(screenshot_path).lstrip("/")
        try:
            resolved = target.resolve()
            uploads_root = UPLOADS_DIR.resolve()
            if str(resolved).startswith(str(uploads_root)) and resolved.exists():
                resolved.unlink()
        except FileNotFoundError:
            return

    def send_excel_file(self, workbook, filename):
        buffer = io.BytesIO()
        workbook.save(buffer)
        data = buffer.getvalue()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def export_guilds_excel(self):
        with open_db() as connection:
            guilds = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT alliance, hill, guild_code, guild_prefix, guild, guild_power, leader_name, updated_at
                    FROM guild_registry
                    ORDER BY CAST(COALESCE(NULLIF(guild_code, ''), '0') AS INTEGER) DESC, guild_prefix ASC, guild ASC
                    """
                ).fetchall()
            ]

        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.title = "guilds"
        sheet.append(["联盟名称", "山头号", "山头名", "妖盟名称", "妖盟总战力", "盟主昵称"])
        for guild in guilds:
            sheet.append([
                "🔮联盟",
                guild.get("guild_code") or "",
                guild.get("guild_prefix") or "",
                guild.get("guild") or "",
                format_number(guild.get("guild_power", 0)),
                guild.get("leader_name") or "",
            ])
        emoji_font = Font(name="Segoe UI Emoji")
        for cell in sheet["A"]:
            cell.font = emoji_font
        self.send_excel_file(workbook, "guilds_export.xlsx")

    def export_guild_members_excel(self, guild_key):
        with open_db() as connection:
            guild = connection.execute(
                """
                SELECT alliance, hill, guild_code, guild_prefix, guild, guild_power, leader_name, updated_at
                FROM guild_registry
                WHERE guild_key = ?
                """,
                (guild_key,),
            ).fetchone()
            if not guild:
                self.send_json({"error": "妖盟不存在"}, status=HTTPStatus.NOT_FOUND)
                return

            members = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT name, role, realm, power, speed, pet, bonus_damage, damage_reduction, note, updated_at
                    FROM members
                    WHERE guild_code = ? AND guild_prefix = ? AND guild = ?
                    ORDER BY power DESC, id DESC
                    """,
                    (guild["guild_code"], guild["guild_prefix"], guild["guild"]),
                ).fetchall()
            ]

        workbook = openpyxl.Workbook()
        sheet = workbook.active
        sheet.title = "members"
        sheet.append([
            "联盟名称",
            "山头号",
            "山名字号",
            "妖盟名称",
            "妖盟总战力",
            "成员昵称",
            "等级",
            "境界",
            "战力",
            "敏捷",
            "灵兽",
            "增伤",
            "减伤",
        ])
        for member in members:
            sheet.append([
                "🔮联盟",
                guild["guild_code"] or "",
                guild["guild_prefix"] or "",
                guild["guild"] or "",
                format_number(guild["guild_power"] or 0),
                member.get("name") or "",
                member.get("role") or "",
                member.get("realm") or "",
                format_number(member.get("power", 0)),
                format_number(member.get("speed", 0)),
                member.get("pet") or "",
                member.get("bonus_damage") if member.get("bonus_damage") not in (None, "") else "",
                member.get("damage_reduction") if member.get("damage_reduction") not in (None, "") else "",
            ])
        emoji_font = Font(name="Segoe UI Emoji")
        for cell in sheet["A"]:
            cell.font = emoji_font
        safe_code = guild["guild_code"] or "guild"
        self.send_excel_file(workbook, f"guild_members_{safe_code}.xlsx")
