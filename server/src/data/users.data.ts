import { db } from '../database/db'
import { User } from '../models/user.model'

export function findUserById(id: number): User | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined
}

export function listUsers(): User[] {
  return db.prepare('SELECT id, email, name, role FROM users ORDER BY name').all() as User[]
}
