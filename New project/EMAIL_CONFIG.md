# 邮箱服务配置说明

本项目使用腾讯 QQ 邮箱 SMTP 服务发送验证码邮件。以下是配置步骤：

## 📧 获取 QQ 邮箱授权码

### 步骤 1：开启 SMTP 服务

1. 登录 QQ 邮箱网页版：https://mail.qq.com
2. 点击右上角 **设置** → **账户**
3. 向下滚动找到 **POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV服务**
4. 找到 **SMTP 服务**，点击 **开启**
5. 按照提示发送短信验证
6. 验证通过后会获得一个 **16 位授权码**

### 步骤 2：复制授权码

授权码格式类似：`abcdefghijklmnop`

> ⚠️ 注意：授权码不是 QQ 密码，请妥善保管！

---

## 🔧 修改配置文件

打开 `auth.py` 文件，找到顶部的 SMTP 配置：

```python
SMTP_CONFIG = {
    "host": "smtp.qq.com",
    "port": 587,
    "use_tls": True,
    "username": "your_email@qq.com",  # ← 替换为你的 QQ 邮箱
    "password": "your授权码",          # ← 替换为你的授权码
    "from_name": "寻道大千联盟",
}
```

### 配置说明

| 配置项 | 说明 | 示例值 |
|--------|------|--------|
| host | SMTP 服务器地址 | smtp.qq.com |
| port | 端口号（TLS 方式） | 587 |
| use_tls | 是否使用 TLS 加密 | True |
| username | 你的 QQ 邮箱地址 | 123456@qq.com |
| password | QQ 邮箱授权码 | abcdefghijklmnop |
| from_name | 邮件发件人显示名称 | 寻道大千联盟 |

---

## 🧪 测试邮件功能

启动服务器后，可以访问找回密码页面测试：

1. 访问 http://127.0.0.1:8000/forgot.html
2. 输入注册时使用的邮箱
3. 点击发送验证码
4. 检查邮箱是否收到邮件

---

## ❓ 常见问题

### Q: 收不到邮件怎么办？

1. 检查垃圾邮件箱
2. 确认邮箱地址填写正确
3. 确认授权码正确且未过期
4. 检查服务器控制台是否有错误信息

### Q: 提示 "发送验证码失败"？

1. 确认已正确填写 SMTP 配置
2. 确认 QQ 邮箱的 SMTP 服务已开启
3. 确认授权码有效（如过期需要重新生成）

### Q: 能否使用其他邮箱？

可以！只需修改 SMTP 配置：

**163 邮箱：**
```python
SMTP_CONFIG = {
    "host": "smtp.163.com",
    "port": 465,  # 使用 SSL
    "use_tls": False,
    "ssl": True,
    "username": "your_email@163.com",
    "password": "your授权码",
    "from_name": "寻道大千联盟",
}
```

**Gmail：**
```python
SMTP_CONFIG = {
    "host": "smtp.gmail.com",
    "port": 587,
    "use_tls": True,
    "username": "your_email@gmail.com",
    "password": "your应用密码",
    "from_name": "寻道大千联盟",
}
```

> 💡 Gmail 需要使用"应用密码"而不是登录密码，请在 Google 账户设置中生成。

---

## 🔒 安全建议

1. **不要提交授权码到 Git** - 请将 `auth.py` 添加到 `.gitignore`
2. **使用环境变量** - 生产环境建议使用环境变量存储敏感信息
3. **限制邮件发送频率** - 防止被滥用

---

如有问题，请检查服务器启动时的控制台输出。
