"""建表入口：python -m app.init_db

生产环境建议改用 scripts/init_db.sql。
"""

import asyncio

from app.db import create_all

if __name__ == '__main__':
    asyncio.run(create_all())
    print('tables created')
