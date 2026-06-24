from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://gael:gael@postgres:5432/gael"
    UPLOADS_DIR: str = "/uploads"

    class Config:
        env_file = ".env"


settings = Settings()
