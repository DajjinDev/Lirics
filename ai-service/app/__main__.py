"""`python -m app`: arranca el servicio con la configuración de las variables LIRIKS_AI_*."""

import uvicorn

from .config import Settings

if __name__ == "__main__":
    s = Settings.from_env()
    uvicorn.run("app.main:app", host=s.host, port=s.port)
