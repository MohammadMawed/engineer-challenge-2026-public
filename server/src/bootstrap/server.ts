import 'dotenv/config'
import { app } from '../routes/api.routes'

const port = process.env.PORT || 4000
app.listen(port, () => {
  console.log(`Pulse API running on http://localhost:${port}`)
})
