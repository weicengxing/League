from alliance_server.shared import *

from auth import ROLE_ALLIANCEADMIN, get_current_auth, update_user_sessions_for_user

class MemberGuildMixin:
    def touch_member(self, member_id):
        if not str(member_id).isdigit():
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return
        timestamp = now_text()
        with open_db() as connection:
            connection.execute(
                "UPDATE members SET updated_at = ? WHERE id = ?",
                (timestamp, int(member_id)),
            )
            row = connection.execute("SELECT * FROM members WHERE id = ?", (int(member_id),)).fetchone()
            connection.commit()
        if not row:
            self.send_json({"error": "成员不存在"}, status=HTTPStatus.NOT_FOUND)
            return
        self.send_json({"message": "成员编辑时间已刷新", "item": serialize_member(dict(row))})

    def build_dashboard(self):
        with open_db() as connection:
            members = [dict(row) for row in connection.execute("SELECT * FROM members").fetchall()]
            guild_registry = [dict(row) for row in connection.execute("SELECT * FROM guild_registry").fetchall()]
            announcements = [dict(row) for row in connection.execute("SELECT * FROM announcements ORDER BY id DESC").fetchall()]

        total_power = sum(member["power"] for member in members)
        hill_map = {}
        for registry in guild_registry:
            hill_name = registry["hill"] or "默认山头"
            guild_key = registry["guild_key"]
            hill_entry = hill_map.setdefault(hill_name, {"count": 0, "power": 0, "guilds": {}})
            hill_entry["guilds"].setdefault(guild_key, {
                "name": registry["guild"],
                "code": registry.get("guild_code", ""),
                "prefix": registry.get("guild_prefix", ""),
                "display_name": build_guild_display_name(registry.get("guild_code", ""), registry.get("guild_prefix", ""), registry["guild"]),
                "count": 0,
                "power": 0,
                "custom_power": int(registry.get("guild_power", 0) or 0),
                "top_member": None,
                "leader_name": registry.get("leader_name", ""),
                "updated_at": registry.get("updated_at", ""),
            })

        for member in members:
            hill_name = member["hill"] or "默认山头"
            guild_name = member["guild"]
            guild_code = member.get("guild_code", "")
            guild_prefix = member.get("guild_prefix", "")
            guild_key = build_guild_key(guild_code, guild_prefix, guild_name)
            hill_entry = hill_map.setdefault(hill_name, {"count": 0, "power": 0, "guilds": {}})
            hill_entry["count"] += 1
            hill_entry["power"] += member["power"]
            guild_entry = hill_entry["guilds"].setdefault(guild_key, {
                "name": guild_name,
                "code": guild_code,
                "prefix": guild_prefix,
                "display_name": build_guild_display_name(guild_code, guild_prefix, guild_name),
                "count": 0,
                "power": 0,
                "custom_power": 0,
                "top_member": None,
                "leader_name": "",
                "updated_at": "",
            })
            guild_entry["count"] += 1
            guild_entry["power"] += member["power"]
            guild_entry["custom_power"] = max(guild_entry["custom_power"], int(member.get("guild_power", 0) or 0))
            guild_entry["updated_at"] = max(guild_entry.get("updated_at", ""), member.get("updated_at", "") or member.get("created_at", ""))
            if member.get("role") == "盟主" and member.get("name"):
                guild_entry["leader_name"] = member["name"]
            if guild_entry["top_member"] is None or member["power"] > guild_entry["top_member"]["power"]:
                guild_entry["top_member"] = member

        hills = []
        flat_guilds = []
        for hill_name, hill_info in sorted(hill_map.items(), key=lambda item: item[1]["power"], reverse=True):
            guilds = []
            for _, guild_info in sorted(hill_info["guilds"].items(), key=lambda item: item[1]["power"], reverse=True):
                guild_payload = {
                    "key": build_guild_key(guild_info["code"], guild_info["prefix"], guild_info["name"]),
                    "name": guild_info["name"],
                    "code": guild_info["code"],
                    "prefix": guild_info["prefix"],
                    "display_name": guild_info["display_name"],
                    "hill": hill_name,
                    "count": guild_info["count"],
                    "power": guild_info["custom_power"] or guild_info["power"],
                    "custom_power": guild_info["custom_power"],
                    "top_member": serialize_member(guild_info["top_member"]) if guild_info["top_member"] else None,
                    "leader_name": guild_info.get("leader_name", ""),
                    "updated_at": guild_info.get("updated_at", ""),
                }
                guilds.append(guild_payload)
                flat_guilds.append(guild_payload)
            hills.append({"name": hill_name, "count": hill_info["count"], "power": hill_info["power"], "guilds": guilds})

        ranking = [serialize_member(member) for member in sorted(members, key=lambda item: item["power"], reverse=True)[:10]]
        public_announcements = [
            {
                "id": row["id"],
                "title": row["title"],
                "content": row["content"],
                "category": row["category"],
                "created_at": row["created_at"],
                "author": row["author"],
            }
            for row in announcements
        ]

        return {
            "alliance_name": members[0]["alliance"] if len({member['alliance'] for member in members}) == 1 else "联盟总览",
            "member_count": len(members),
            "total_power": total_power,
            "guild_count": len(flat_guilds),
            "hill_count": len(hills),
            "top_member": ranking[0] if ranking else None,
            "top_guild": flat_guilds[0] if flat_guilds else None,
            "hills": hills,
            "guilds": flat_guilds,
            "ranking": ranking,
            "announcements": [item for item in public_announcements if item["category"] == "公告"],
            "melon_posts": [item for item in public_announcements if item["category"] == "瓜棚"],
        }

    def list_members(self, query):
        search = (query.get("search", [""])[0]).strip().lower()
        hill = (query.get("hill", ["all"])[0]).strip()
        guild = (query.get("guild", ["all"])[0]).strip()
        sort = (query.get("sort", ["power-desc"])[0]).strip()
        order_sql = {
            "power-desc": "power DESC, id DESC",
            "power-asc": "power ASC, id ASC",
            "name-asc": "name COLLATE NOCASE ASC, id DESC",
        }.get(sort, "power DESC, id DESC")

        clauses = []
        values = []
        if hill and hill != "all":
            clauses.append("hill = ?")
            values.append(hill)
        if guild and guild != "all":
            clauses.append("guild = ?")
            values.append(guild)
        if search:
            clauses.append("(LOWER(alliance) LIKE ? OR LOWER(hill) LIKE ? OR LOWER(guild) LIKE ? OR LOWER(name) LIKE ? OR LOWER(role) LIKE ? OR LOWER(realm) LIKE ? OR LOWER(pet) LIKE ? OR LOWER(note) LIKE ?)")
            keyword = f"%{search}%"
            values.extend([keyword] * 8)

        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        sql = f"SELECT * FROM members {where_sql} ORDER BY {order_sql}"
        with open_db() as connection:
            rows = connection.execute(sql, values).fetchall()
        return {"items": [serialize_member(dict(row)) for row in rows]}

    def list_announcements(self):
        with open_db() as connection:
            rows = connection.execute("SELECT * FROM announcements ORDER BY id DESC").fetchall()
        return {
            "items": [
                {
                    "id": row["id"],
                    "title": row["title"],
                    "content": row["content"],
                    "category": row["category"],
                    "created_at": row["created_at"],
                    "author": row["author"],
                }
                for row in rows
            ]
        }

    def login(self, payload):
        username = str(payload.get("username", "")).strip()
        password = str(payload.get("password", "")).strip()
        with open_db() as connection:
            row = connection.execute("SELECT * FROM admins WHERE username = ?", (username,)).fetchone()

        if not row:
            self.send_json({"error": "账号或密码错误"}, status=HTTPStatus.UNAUTHORIZED)
            return

        calculated = hash_password(password, row["salt"])
        if not hmac.compare_digest(calculated, row["password_hash"]):
            self.send_json({"error": "账号或密码错误"}, status=HTTPStatus.UNAUTHORIZED)
            return

        token = secrets.token_hex(24)
        sessions[token] = {"admin_id": row["id"], "username": row["username"], "display_name": row["display_name"], "created_at": datetime.now().timestamp()}

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Set-Cookie", f"{SESSION_COOKIE}={token}; HttpOnly; Path=/; SameSite=Lax")
        self.end_headers()
        self.wfile.write(json.dumps({"message": "登录成功", "admin": {"username": row["username"], "display_name": row["display_name"]}}, ensure_ascii=False).encode("utf-8"))

    def logout(self):
        token = self.read_session_token()
        if token:
            sessions.pop(token, None)

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Set-Cookie", f"{SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax")
        self.end_headers()
        self.wfile.write(json.dumps({"message": "已退出登录"}, ensure_ascii=False).encode("utf-8"))

    def create_member(self, payload):
        try:
            member = validate_member(payload)
        except ValueError as error:
            self.send_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
            return
        timestamp = now_text()
        member["created_at"] = timestamp
        member["updated_at"] = timestamp
        with open_db() as connection:
            if not guild_exists(connection, member["guild_code"], member["guild_prefix"], member["guild"]):
                self.send_json({"error": "该妖盟不存在，请先创建妖盟"}, status=HTTPStatus.BAD_REQUEST)
                return
            if member_name_exists(connection, member["guild_code"], member["guild_prefix"], member["guild"], member["name"]):
                self.send_json({"error": "该成员在当前妖盟里已存在"}, status=HTTPStatus.CONFLICT)
                return
            cursor = connection.execute(
                """
                INSERT INTO members (
                    alliance, hill, guild_code, guild_prefix, guild_power, guild, name, role, realm, power, hp, attack, defense, speed, bonus_damage, damage_reduction, pet, note, screenshot_path, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    member["alliance"], member["hill"], member["guild_code"], member["guild_prefix"], member["guild_power"], member["guild"], member["name"], member["role"], member["realm"], member["power"],
                    member["hp"], member["attack"], member["defense"], member["speed"], member["bonus_damage"], member["damage_reduction"], member["pet"], member["note"],
                    member["screenshot_path"],
                    timestamp, timestamp,
                ),
            )
            upsert_guild_registry(connection, member)
            connection.commit()

        member["id"] = cursor.lastrowid
        self.send_json({"message": "成员创建成功", "item": member}, status=HTTPStatus.CREATED)

    def create_guild(self, payload):
        try:
            guild = validate_guild(payload)
        except ValueError as error:
            self.send_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
            return
        timestamp = now_text()
        guild["updated_at"] = timestamp
        guild_key = build_guild_key(guild["guild_code"], guild["guild_prefix"], guild["guild"])
        with open_db() as connection:
            if guild_exists(connection, guild["guild_code"], guild["guild_prefix"], guild["guild"]):
                self.send_json({"error": f"妖盟编号 {guild['guild_code'] or guild['guild']} 已存在，不能重复创建"}, status=HTTPStatus.CONFLICT)
                return
            exists = connection.execute("SELECT 1 FROM guild_registry WHERE guild_key = ?", (guild_key,)).fetchone()
            if exists:
                self.send_json({"error": "该妖盟已存在"}, status=HTTPStatus.CONFLICT)
                return
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
        self.send_json({"message": "妖盟创建成功", "item": {**guild, "guild_key": guild_key}}, status=HTTPStatus.CREATED)

    def update_member(self, member_id, payload):
        try:
            member = validate_member(payload)
        except ValueError as error:
            self.send_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
            return
        timestamp = now_text()
        with open_db() as connection:
            existing = connection.execute(
                "SELECT guild_code, guild_prefix, guild FROM members WHERE id = ?",
                (member_id,),
            ).fetchone()
            if not existing:
                self.send_json({"error": "成员不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            if not guild_exists(connection, member["guild_code"], member["guild_prefix"], member["guild"]):
                self.send_json({"error": "目标妖盟不存在，请先创建妖盟"}, status=HTTPStatus.BAD_REQUEST)
                return
            if member["name"] and member_name_exists(connection, member["guild_code"], member["guild_prefix"], member["guild"], member["name"], exclude_id=int(member_id)):
                self.send_json({"error": "该成员在当前妖盟里已存在"}, status=HTTPStatus.CONFLICT)
                return
            cursor = connection.execute(
                """
                UPDATE members
                SET alliance = ?, hill = ?, guild_code = ?, guild_prefix = ?, guild_power = ?, guild = ?, name = ?, role = ?, realm = ?, power = ?, hp = ?, attack = ?, defense = ?, speed = ?, bonus_damage = ?, damage_reduction = ?, pet = ?, note = ?, screenshot_path = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    member["alliance"], member["hill"], member["guild_code"], member["guild_prefix"], member["guild_power"], member["guild"], member["name"], member["role"], member["realm"], member["power"],
                    member["hp"], member["attack"], member["defense"], member["speed"], member["bonus_damage"], member["damage_reduction"], member["pet"], member["note"],
                    member["screenshot_path"],
                    timestamp, member_id,
                ),
            )
            member["updated_at"] = timestamp
            upsert_guild_registry(connection, member)
            if existing:
                old_key = build_guild_key(existing["guild_code"], existing["guild_prefix"], existing["guild"])
                new_key = build_guild_key(member["guild_code"], member["guild_prefix"], member["guild"])
                if old_key != new_key:
                    remaining = connection.execute(
                        "SELECT COUNT(*) AS count FROM members WHERE guild_code = ? AND guild_prefix = ? AND guild = ?",
                        (existing["guild_code"], existing["guild_prefix"], existing["guild"]),
                    ).fetchone()["count"]
                    if remaining == 0:
                        connection.execute("DELETE FROM guild_registry WHERE guild_key = ?", (old_key,))
            connection.commit()

        if cursor.rowcount == 0:
            self.send_json({"error": "成员不存在"}, status=HTTPStatus.NOT_FOUND)
            return

        member["id"] = int(member_id)
        member["updated_at"] = timestamp
        self.send_json({"message": "成员更新成功", "item": member})

    def update_guild(self, guild_key, payload):
        timestamp = now_text()
        affected_user_leagues = {}
        with open_db() as connection:
            existing = connection.execute("SELECT * FROM guild_registry WHERE guild_key = ?", (guild_key,)).fetchone()
            if not existing:
                self.send_json({"error": "妖盟不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            locked_payload = dict(payload)
            locked_payload["guild_code"] = existing["guild_code"]
            locked_payload["guild_prefix"] = existing["guild_prefix"]
            try:
                guild = validate_guild(locked_payload)
            except ValueError as error:
                self.send_json({"error": str(error)}, status=HTTPStatus.BAD_REQUEST)
                return
            next_key = build_guild_key(guild["guild_code"], guild["guild_prefix"], guild["guild"])
            duplicate_code = guild_exists(connection, guild["guild_code"], guild["guild_prefix"], guild["guild"], exclude_key=guild_key)
            if duplicate_code:
                self.send_json({"error": f"妖盟编号 {guild['guild_code'] or guild['guild']} 已存在，不能重复保存"}, status=HTTPStatus.CONFLICT)
                return
            if next_key != guild_key:
                conflict = connection.execute("SELECT 1 FROM guild_registry WHERE guild_key = ?", (next_key,)).fetchone()
                if conflict:
                    self.send_json({"error": "新的妖盟标识已存在"}, status=HTTPStatus.CONFLICT)
                    return
                connection.execute("DELETE FROM guild_registry WHERE guild_key = ?", (guild_key,))
            connection.execute(
                """
                INSERT INTO guild_registry (
                    guild_key, alliance, hill, guild_code, guild_prefix, guild, guild_power, leader_name, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(guild_key) DO UPDATE SET
                    alliance = excluded.alliance,
                    hill = excluded.hill,
                    guild_code = excluded.guild_code,
                    guild_prefix = excluded.guild_prefix,
                    guild = excluded.guild,
                    guild_power = excluded.guild_power,
                    leader_name = excluded.leader_name,
                    updated_at = excluded.updated_at
                """,
                (
                    next_key,
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
            connection.execute(
                """
                UPDATE members
                SET alliance = ?, hill = ?, guild_code = ?, guild_prefix = ?, guild = ?, guild_power = ?, updated_at = ?
                WHERE guild_code = ? AND guild_prefix = ? AND guild = ?
                """,
                (
                    guild["alliance"],
                    guild["hill"],
                    guild["guild_code"],
                    guild["guild_prefix"],
                    guild["guild"],
                    guild["guild_power"],
                    timestamp,
                    existing["guild_code"],
                    existing["guild_prefix"],
                    existing["guild"],
                ),
            )
            if guild["leader_name"]:
                connection.execute(
                    """
                    UPDATE members
                    SET name = ?, updated_at = ?
                    WHERE guild_code = ? AND guild_prefix = ? AND guild = ? AND id = (
                        SELECT id FROM members
                        WHERE guild_code = ? AND guild_prefix = ? AND guild = ?
                        ORDER BY power DESC, id ASC LIMIT 1
                    )
                    """,
                    (
                        guild["leader_name"],
                        timestamp,
                        guild["guild_code"],
                        guild["guild_prefix"],
                        guild["guild"],
                        guild["guild_code"],
                        guild["guild_prefix"],
                        guild["guild"],
                    ),
                )
            if next_key != guild_key:
                affected_rows = connection.execute(
                    "SELECT id, league FROM users WHERE league LIKE ?",
                    (f"%{guild_key}%",),
                ).fetchall()
                if affected_rows:
                    connection.execute(
                        """
                        UPDATE users
                        SET league = REPLACE(league, ?, ?)
                        WHERE league LIKE ?
                        """,
                        (guild_key, next_key, f"%{guild_key}%"),
                    )
                    for row in affected_rows:
                        affected_user_leagues[int(row["id"])] = str(row["league"] or "").replace(guild_key, next_key)
            linked_users = connection.execute(
                """
                SELECT DISTINCT u.id, u.role, u.league
                FROM users u
                INNER JOIN members m ON m.id = COALESCE(u.member_id, u.member)
                WHERE m.guild_code = ? AND m.guild_prefix = ? AND m.guild = ?
                """,
                (
                    guild["guild_code"],
                    guild["guild_prefix"],
                    guild["guild"],
                ),
            ).fetchall()
            for row in linked_users:
                user_id = int(row["id"])
                current_league = str(row["league"] or "")
                if str(row["role"] or "") == ROLE_ALLIANCEADMIN:
                    next_league = current_league.replace(guild_key, next_key) if next_key != guild_key else current_league
                else:
                    next_league = next_key
                if next_league != current_league:
                    connection.execute(
                        "UPDATE users SET league = ? WHERE id = ?",
                        (next_league, user_id),
                    )
                    affected_user_leagues[user_id] = next_league
            connection.commit()
        self.send_json({"message": "妖盟更新成功", "item": {**guild, "guild_key": next_key}})

        for user_id, next_league in affected_user_leagues.items():
            update_user_sessions_for_user(user_id, league=next_league)

    def delete_guild(self, guild_key):
        with open_db() as connection:
            existing = connection.execute("SELECT * FROM guild_registry WHERE guild_key = ?", (guild_key,)).fetchone()
            if not existing:
                self.send_json({"error": "妖盟不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            connection.execute(
                "DELETE FROM members WHERE guild_code = ? AND guild_prefix = ? AND guild = ?",
                (existing["guild_code"], existing["guild_prefix"], existing["guild"]),
            )
            connection.execute("DELETE FROM guild_registry WHERE guild_key = ?", (guild_key,))
            connection.commit()
        self.send_json({"message": "妖盟删除成功"})

    def create_announcement(self, payload):
        title = str(payload.get("title", "")).strip()
        content = sanitize_rich_html(payload.get("content", ""))
        category = str(payload.get("category", "公告")).strip() or "公告"
        if not title or not content:
            self.send_json({"error": "标题和内容不能为空"}, status=HTTPStatus.BAD_REQUEST)
            return
        if category not in {"公告", "瓜棚"}:
            self.send_json({"error": "分类不正确"}, status=HTTPStatus.BAD_REQUEST)
            return

        timestamp = now_text()
        with open_db() as connection:
            cursor = connection.execute(
                "INSERT INTO announcements (title, content, category, created_at, author) VALUES (?, ?, ?, ?, ?)",
                (title, content, category, timestamp, ""),
            )
            connection.commit()

        self.send_json(
            {"message": "内容发布成功", "item": {"id": cursor.lastrowid, "title": title, "content": content, "category": category, "created_at": timestamp}},
            status=HTTPStatus.CREATED,
        )
    def create_melon_post(self, user, payload):
        """Create a melon post - called from /api/melon endpoint."""
        title = str(payload.get("title", "")).strip()
        content = sanitize_rich_html(payload.get("content", ""))
        if not title or not content:
            self.send_json({"error": "标题和内容不能为空"}, status=HTTPStatus.BAD_REQUEST)
            return

        # Get author name from user object
        author_name = user.get("username") or user.get("display_name") or "匿名用户"
        user_id = user.get("id") or user.get("admin_id")

        # Create melon post
        melon_item = create_melon_post(title, content, author_name, user_id)

        self.send_json(
            {"message": "瓜棚发布成功", "item": melon_item},
            status=HTTPStatus.CREATED,
        )

        try:
            broadcast_melon_post(melon_item)
        except Exception:
            pass

    def delete_melon_post(self, user, melon_id):
        """Delete a melon post - called from /api/melon/<id> endpoint."""
        if not melon_id.isdigit():
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return

        user_id = user.get("id") or user.get("admin_id")
        username = user.get("username") or user.get("display_name") or ""

        with open_db() as connection:
            # Get the melon post
            row = connection.execute(
                "SELECT id, title, author, created_at FROM announcements WHERE id = ? AND category = '瓜棚'",
                (melon_id,),
            ).fetchone()

            if not row:
                self.send_json({"error": "瓜棚动态不存在"}, status=HTTPStatus.NOT_FOUND)
                return

            # Check if the user is the author (compare by username/display_name)
            author = row["author"] or ""
            if author != username:
                self.send_json({"error": "只有发布者才能撤回"}, status=HTTPStatus.FORBIDDEN)
                return

            # Check if within 2 minutes
            created_at = row["created_at"]
            try:
                created_time = datetime.strptime(created_at, "%Y-%m-%d %H:%M:%S")
                elapsed = (datetime.now() - created_time).total_seconds()
                if elapsed > 120:  # 2 minutes = 120 seconds
                    self.send_json({"error": "已超过2分钟，无法撤回"}, status=HTTPStatus.FORBIDDEN)
                    return
            except (ValueError, TypeError):
                self.send_json({"error": "时间解析错误"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
                return

            # Delete the melon post
            cursor = connection.execute(
                "DELETE FROM announcements WHERE id = ?",
                (melon_id,),
            )
            connection.commit()

        if cursor.rowcount == 0:
            self.send_json({"error": "删除失败"}, status=HTTPStatus.NOT_FOUND)
            return

        try:
            broadcast_melon_deleted(int(melon_id))
        except Exception:
            pass

        self.send_json({"message": "撤回成功", "deleted_id": int(melon_id)})

    def update_announcement(self, announcement_id, payload):
        title = str(payload.get("title", "")).strip()
        content = sanitize_rich_html(payload.get("content", ""))
        category = str(payload.get("category", "公告")).strip() or "公告"
        if not title or not content:
            self.send_json({"error": "标题和内容不能为空"}, status=HTTPStatus.BAD_REQUEST)
            return

        with open_db() as connection:
            cursor = connection.execute(
                "UPDATE announcements SET title = ?, content = ?, category = ? WHERE id = ?",
                (title, content, category, announcement_id),
            )
            connection.commit()

        if cursor.rowcount == 0:
            self.send_json({"error": "内容不存在"}, status=HTTPStatus.NOT_FOUND)
            return

        self.send_json({"message": "内容更新成功"})

    def get_member_screenshot(self, member_id):
        if not member_id.isdigit():
            return {"error": "参数无效"}
        with open_db() as connection:
            row = connection.execute("SELECT id, name, screenshot_path FROM members WHERE id = ?", (member_id,)).fetchone()
        if not row:
            return {"error": "成员不存在"}
        screenshot_url = row["screenshot_path"] or ""
        return {
            "member_id": row["id"],
            "member_name": row["name"],
            "screenshot_url": screenshot_url,
            "has_screenshot": bool(screenshot_url),
        }

    def upload_member_screenshot(self, member_id):
        if not member_id.isdigit():
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return

        with open_db() as connection:
            row = connection.execute("SELECT id, screenshot_path FROM members WHERE id = ?", (member_id,)).fetchone()
        if not row:
            self.send_json({"error": "成员不存在"}, status=HTTPStatus.NOT_FOUND)
            return

        form = parse_form_data(self)
        file_item = form.get("screenshot") if hasattr(form, 'get') else form.get("screenshot") if isinstance(form, dict) else None
        if file_item is None or getattr(file_item, "file", None) is None:
            self.send_json({"error": "请先选择截图文件"}, status=HTTPStatus.BAD_REQUEST)
            return

        raw = file_item.file.read()
        if not raw:
            self.send_json({"error": "截图文件不能为空"}, status=HTTPStatus.BAD_REQUEST)
            return
        if len(raw) > 8 * 1024 * 1024:
            self.send_json({"error": "截图不能超过 8MB"}, status=HTTPStatus.BAD_REQUEST)
            return

        filename = Path(getattr(file_item, "filename", "") or "")
        suffix = filename.suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
            self.send_json({"error": "仅支持 png、jpg、jpeg、gif、webp 图片"}, status=HTTPStatus.BAD_REQUEST)
            return

        self.delete_member_screenshot_file(row["screenshot_path"])
        version_token = datetime.now().strftime("%Y%m%d%H%M%S")
        relative_path = f"/uploads/member-screenshots/member-{member_id}-{version_token}{suffix}"
        target_path = PUBLIC_DIR / relative_path.lstrip("/")
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(raw)

        timestamp = now_text()
        with open_db() as connection:
            connection.execute(
                "UPDATE members SET screenshot_path = ?, updated_at = ? WHERE id = ?",
                (relative_path, timestamp, member_id),
            )
            connection.commit()

        self.send_json(
            {
                "message": "成员截图上传成功",
                "item": {
                    "member_id": int(member_id),
                    "screenshot_url": relative_path,
                    "updated_at": timestamp,
                },
            }
        )

    def delete_member_screenshot(self, member_id):
        if not member_id.isdigit():
            self.send_json({"error": "参数无效"}, status=HTTPStatus.BAD_REQUEST)
            return

        with open_db() as connection:
            row = connection.execute("SELECT id, screenshot_path FROM members WHERE id = ?", (member_id,)).fetchone()
        if not row:
            self.send_json({"error": "成员不存在"}, status=HTTPStatus.NOT_FOUND)
            return
        if not row["screenshot_path"]:
            self.send_json({"error": "该成员当前没有截图"}, status=HTTPStatus.BAD_REQUEST)
            return

        self.delete_member_screenshot_file(row["screenshot_path"])
        timestamp = now_text()
        with open_db() as connection:
            connection.execute(
                "UPDATE members SET screenshot_path = '', updated_at = ? WHERE id = ?",
                (timestamp, member_id),
            )
            connection.commit()

        self.send_json(
            {
                "message": "成员截图已删除",
                "item": {
                    "member_id": int(member_id),
                    "screenshot_url": "",
                    "updated_at": timestamp,
                },
            }
        )
