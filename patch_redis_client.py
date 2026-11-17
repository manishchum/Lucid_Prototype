with open('Backend/utils/redis_client.py', 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
skip = False
for line in lines:
    if line.strip().startswith("redis_client = redis.Redis("):
        skip = True
        new_lines.append("redis_pool = redis.ConnectionPool(\n")
        new_lines.append('    host=os.getenv("REDIS_HOST", "127.0.0.1"),\n')
        new_lines.append('    port=int(os.getenv("REDIS_PORT") or 6379),\n')
        new_lines.append('    username=os.getenv("REDIS_USERNAME"),\n')
        new_lines.append('    password=os.getenv("REDIS_PASSWORD"),\n')
        new_lines.append('    decode_responses=True,\n')
        new_lines.append('    ssl=redis_ssl,\n')
        new_lines.append('    ssl_cert_reqs=None if redis_ssl else None,\n')
        new_lines.append('    max_connections=10,\n')
        new_lines.append('    socket_timeout=5.0,\n')
        new_lines.append('    socket_connect_timeout=3.0,\n')
        new_lines.append(")\n\n")
        new_lines.append("redis_client = redis.Redis(connection_pool=redis_pool)\n")
        continue
    if skip:
        if line.strip() == ")":
            skip = False
        continue
    new_lines.append(line)

with open('Backend/utils/redis_client.py', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)
print("Successfully updated redis_client.py!")

