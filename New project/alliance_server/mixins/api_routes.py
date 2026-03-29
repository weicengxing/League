from alliance_server.shared import *

from auth import ROLE_GUEST, ROLE_SUPERADMIN, get_current_auth

class ApiRoutesMixin:
    def handle_api_get(self, parsed):
        if parsed.path == "/api/health":
            self.send_json({"status": "ok", "time": now_text()})
            return
        if parsed.path == "/api/me":
            self.send_json(get_current_auth(self))
            return
        if parsed.path == "/api/dashboard":
            self.send_json(self.build_dashboard())
            return
        if parsed.path == "/api/profile/me":
            self.send_json(self.get_current_user_profile())
            return
        if parsed.path == "/api/members":
            query = parse_qs(parsed.query)
            self.send_json(self.list_members(query))
            return
        if parsed.path == "/api/guilds/export":
            admin = self.require_admin()
            if not admin:
                return
            self.export_guilds_excel()
            return
        if parsed.path == "/api/announcements":
            self.send_json(self.list_announcements())
            return
        if parsed.path == "/api/member-cert-requests":
            current = get_current_auth(self)
            if not current.get("authenticated"):
                self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
                return
            query = parse_qs(parsed.query)
            member_id = query.get("member_id", [""])[0].strip() or None
            self.send_json(self.list_member_cert_requests(current, member_id=member_id))
            return
        if parsed.path == "/api/member-cert-requests/mine":
            current = get_current_auth(self)
            if not current.get("authenticated"):
                self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
                return
            self.send_json(self.list_member_cert_requests(current, mine=True))
            return
        if parsed.path == "/api/admin-role-requests":
            user = self.require_permission("manage_roles")
            if not user:
                return
            query = parse_qs(parsed.query)
            mark_read = query.get("mark_read", ["0"])[0] in {"1", "true", "yes"}
            self.send_json(self.list_admin_role_requests(mark_read=mark_read))
        if parsed.path.startswith("/api/guilds/") and parsed.path.endswith("/members/export"):
            admin = self.require_admin()
            if not admin:
                return
            guild_key = unquote(parsed.path.strip("/").split("/")[2])
            self.export_guild_members_excel(guild_key)
            return
        if parsed.path.startswith("/api/members/") and parsed.path.endswith("/screenshot"):
            member_id = parsed.path.strip("/").split("/")[2]
            self.send_json(self.get_member_screenshot(member_id))
            return
        self.send_json({"error": "接口不存在"}, status=HTTPStatus.NOT_FOUND)

    def handle_api_post(self, parsed):
        if parsed.path == "/api/guilds":
            payload = self.read_json()
            user = self.require_permission("manage_guilds", payload.get("alliance", ""))
            if not user:
                return
            self.create_guild(payload)
            return
        if parsed.path == "/api/guilds/import":
            admin = self.require_admin()
            if not admin:
                return
            self.import_guilds_from_excel()
            return
        if parsed.path == "/api/members":
            payload = self.read_json()
            user = self.require_permission("manage_members", payload.get("alliance", ""))
            if not user:
                return
            self.create_member(payload)
            return
        if parsed.path == "/api/profile/me/screenshot":
            user = self.require_permission("upload_own_screenshot", allow_admin_account=False)
            if not user:
                return
            self.upload_current_user_screenshot(user)
            return
        if parsed.path == "/api/login":
            AuthHandler(self).login()
            return
        if parsed.path == "/api/logout":
            AuthHandler(self).logout()
            return
        if parsed.path == "/api/announcements":
            user = self.require_permission("manage_announcements")
            if not user:
                return
            payload = self.read_json()
            self.create_announcement(payload)
            return
        if parsed.path.startswith("/api/members/") and parsed.path.endswith("/screenshot"):
            member_id = parsed.path.strip("/").split("/")[2]
            member = self.get_member_item(member_id)
            if not member:
                self.send_json({"error": "成员不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            user = self.require_permission("manage_members", member.get("alliance", ""))
            if not user:
                return
            self.upload_member_screenshot(member_id)
            return
        if parsed.path == "/api/members/import":
            current = get_current_auth(self)
            if not current.get("authenticated"):
                self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
                return
            user = current.get("user") or {}
            if not self.has_permission(user, "manage_members"):
                self.send_json({"error": "当前账号没有执行该操作的权限"}, status=HTTPStatus.FORBIDDEN)
                return
            self.import_members_from_excel()
            return
        if parsed.path == "/api/member-cert-requests":
            current = get_current_auth(self)
            if not current.get("authenticated") or current.get("user", {}).get("role") != ROLE_GUEST:
                self.send_json({"error": "仅 Guest 可发起认证申请"}, status=HTTPStatus.FORBIDDEN)
                return
            payload = self.read_json()
            self.create_member_cert_request(current, payload)
            return
        if parsed.path == "/api/admin-role-requests":
            current = get_current_auth(self)
            if not current.get("authenticated") or current.get("is_admin"):
                self.send_json({"error": "仅普通用户可申请联盟管理员"}, status=HTTPStatus.FORBIDDEN)
                return
            payload = self.read_json()
            self.create_admin_role_request(current, payload)
            return
        if parsed.path.startswith("/api/member-cert-requests/"):
            current = get_current_auth(self)
            if not current.get("authenticated") or not self.has_permission(current.get("user") or {}, "manage_members"):
                self.send_json({"error": "当前账号没有审核认证申请的权限"}, status=HTTPStatus.FORBIDDEN)
                return
            payload = self.read_json()
            request_id = parsed.path.rsplit("/", 1)[-1]
            self.review_member_cert_request(request_id, payload, current)
            return
        if parsed.path.startswith("/api/admin-role-requests/"):
            user = self.require_permission("manage_roles")
            if not user:
                return
            payload = self.read_json()
            request_id = parsed.path.rsplit("/", 1)[-1]
            self.review_admin_role_request(request_id, payload, {"authenticated": True, "user": user})
            return
        if parsed.path == "/api/melon":
            user = self.get_current_user_or_admin()
            if not user:
                self.send_json({"error": "请先认证"}, status=HTTPStatus.UNAUTHORIZED)
                return
            if not self.has_permission(user, "create_posts"):
                self.send_json({"error": "当前账号没有发布瓜棚的权限"}, status=HTTPStatus.FORBIDDEN)
                return
            payload = self.read_json()
            self.create_melon_post(user, payload)
            return
        self.send_json({"error": "接口不存在"}, status=HTTPStatus.NOT_FOUND)

    def handle_api_put(self, parsed):
        if parsed.path.startswith("/api/guilds/"):
            guild_key = unquote(parsed.path.rsplit("/", 1)[-1])
            existing = self.get_guild_registry_item(guild_key)
            if not existing:
                self.send_json({"error": "妖盟不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            payload = self.read_json()
            user = self.require_permission("manage_guilds", existing.get("alliance", ""))
            if not user:
                return
            target_alliance = str(payload.get("alliance", existing.get("alliance", ""))).strip()
            if target_alliance and target_alliance != str(existing.get("alliance", "")).strip() and not self.can_access_alliance(user, target_alliance, "manage_guilds"):
                self.send_json({"error": "当前账号不能把妖盟调整到其他联盟"}, status=HTTPStatus.FORBIDDEN)
                return
            self.update_guild(guild_key, payload)
            return
        if parsed.path == "/api/profile/me":
            user = self.require_permission("edit_own_profile", allow_admin_account=False)
            if not user:
                return
            payload = self.read_json()
            self.update_current_user_profile(user, payload)
            return
        if parsed.path.startswith("/api/members/"):
            member_id = parsed.path.rsplit("/", 1)[-1]
            existing = self.get_member_item(member_id)
            if not existing:
                self.send_json({"error": "成员不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            payload = self.read_json()
            user = self.require_permission("manage_members", existing.get("alliance", ""))
            if not user:
                return
            target_alliance = str(payload.get("alliance", existing.get("alliance", ""))).strip()
            if target_alliance and target_alliance != str(existing.get("alliance", "")).strip() and not self.can_access_alliance(user, target_alliance, "manage_members"):
                self.send_json({"error": "当前账号不能把成员调整到其他联盟"}, status=HTTPStatus.FORBIDDEN)
                return
            self.update_member(member_id, payload)
            return
        if parsed.path.startswith("/api/announcements/"):
            user = self.require_permission("manage_announcements")
            if not user:
                return
            payload = self.read_json()
            announcement_id = parsed.path.rsplit("/", 1)[-1]
            self.update_announcement(announcement_id, payload)
            return
        self.send_json({"error": "接口不存在"}, status=HTTPStatus.NOT_FOUND)

    def handle_api_delete(self, parsed):
        if parsed.path.startswith("/api/guilds/"):
            guild_key = unquote(parsed.path.rsplit("/", 1)[-1])
            existing = self.get_guild_registry_item(guild_key)
            if not existing:
                self.send_json({"error": "妖盟不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            user = self.require_permission("manage_guilds", existing.get("alliance", ""))
            if not user:
                return
            self.delete_guild(guild_key)
            return
        if parsed.path == "/api/profile/me/screenshot":
            user = self.require_permission("upload_own_screenshot", allow_admin_account=False)
            if not user:
                return
            self.delete_current_user_screenshot(user)
            return
        if parsed.path.startswith("/api/members/") and parsed.path.endswith("/screenshot"):
            member_id = parsed.path.strip("/").split("/")[2]
            member = self.get_member_item(member_id)
            if not member:
                self.send_json({"error": "成员不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            user = self.require_permission("manage_members", member.get("alliance", ""))
            if not user:
                return
            self.delete_member_screenshot(member_id)
            return
        if parsed.path.startswith("/api/members/"):
            member_id = parsed.path.rsplit("/", 1)[-1]
            member = self.get_member_item(member_id)
            if not member:
                self.send_json({"error": "成员不存在"}, status=HTTPStatus.NOT_FOUND)
                return
            user = self.require_permission("manage_members", member.get("alliance", ""))
            if not user:
                return
            self.delete_by_id("members", member_id)
            return
        if parsed.path.startswith("/api/announcements/"):
            user = self.require_permission("manage_announcements")
            if not user:
                return
            announcement_id = parsed.path.rsplit("/", 1)[-1]
            self.delete_by_id("announcements", announcement_id)
            return
        if parsed.path.startswith("/api/melon/"):
            user = self.get_current_user_or_admin()
            if not user:
                self.send_json({"error": "请先登录"}, status=HTTPStatus.UNAUTHORIZED)
                return
            melon_id = parsed.path.rsplit("/", 1)[-1]
            self.delete_melon_post(user, melon_id)
            return
        self.send_json({"error": "接口不存在"}, status=HTTPStatus.NOT_FOUND)
