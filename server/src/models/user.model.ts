export type UserRole = 'agent' | 'manager'

export type User = {
  id: number
  email: string
  name: string
  role: UserRole
}
