from pydantic_settings import BaseSettings

NAMESPACE_PREFIX = "maydaylabs-"
SYSTEM_NAMESPACE = "maydaylabs-system"


class Settings(BaseSettings):
    redis_url: str = "redis://redis:6379/0"
    engine_image: str = "maydaylabs-engine:latest"
    shell_image: str = "maydaylabs-shell:latest"
    engine_sa: str = "maydaylabs-engine"
    kube_context: str = "kind-k8squest"
    # Hard limits
    max_sessions_total: int = 10
    max_sessions_per_level: int = 5
    max_sessions_per_ip: int = 2
    session_ttl_seconds: int = 45 * 60  # 45 minutes
    # Levels disabled in web mode (require node operations)
    disabled_levels: list[str] = ["level-45-node-affinity", "level-46-taints-tolerations"]
    # Worlds root relative to this file (mounted into the backend container)
    worlds_path: str = "/app/worlds"

    class Config:
        env_prefix = "K8SQUEST_"


settings = Settings()
