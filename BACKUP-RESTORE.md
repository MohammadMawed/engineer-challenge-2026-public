# Backup and Restore

Create a consistent, integrity-checked SQLite backup while Pulse is running:

```powershell
npm run backup
```

Backups are written to `server/backups/` and ignored by Git. Keep copies outside the application host according to the client's retention policy.

To restore, stop the API, make one final backup, replace `server/pulse.db` with the selected backup, remove any stale `server/pulse.db-wal` and `server/pulse.db-shm` files, then restart the API. Startup runs tracked migrations and a foreign-key integrity check before accepting requests.
