# Runtime secrets

Create the files without the `.example` suffix before starting the stack:

- `api_key`: random API bootstrap key with at least 32 characters;
- `database_url`: complete PostgreSQL connection URL;
- `redis_password`: random Redis password;
- `aws_access_key_id` and `aws_secret_access_key`: required only with `compose.s3.yaml`.

The runtime files are ignored by Git. On Linux, restrict them to the deployment account:

```bash
chmod 600 secrets/api_key secrets/database_url secrets/redis_password
```

Do not pass these values through `.env`; `.env` contains only non-secret deployment settings.
