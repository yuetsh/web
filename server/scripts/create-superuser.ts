/**
 * 新建超级管理员，或把已有用户设为超级管理员并重设密码。
 *
 *   bun scripts/create-superuser.ts <用户名> <密码>
 */
import { get, run, now } from "../src/db"
import { makePassword } from "../src/auth"

const [username, password] = process.argv.slice(2)
if (!username || !password) {
  console.error("用法：bun scripts/create-superuser.ts <用户名> <密码>")
  process.exit(1)
}

const hash = await makePassword(password)
const user = get<{ id: number }>(`SELECT id FROM account_user WHERE username = $username`, { username })
if (user) {
  run(
    `UPDATE account_user SET password = $hash, raw_password = $raw, role = 'super',
       is_superuser = 1, is_staff = 1, is_active = 1 WHERE id = $id`,
    { hash, raw: password.slice(0, 20), id: user.id },
  )
  run(`DELETE FROM auth_session WHERE user_id = $id`, { id: user.id })
  console.log(`已将 ${username} 设为超级管理员并重设密码`)
} else {
  run(
    `INSERT INTO account_user
       (password, last_login, is_superuser, username, email, is_staff, is_active, date_joined, role, raw_password, classname)
     VALUES ($hash, NULL, 1, $username, '', 1, 1, $now, 'super', $raw, '')`,
    { hash, username, now: now(), raw: password.slice(0, 20) },
  )
  console.log(`已创建超级管理员 ${username}`)
}
