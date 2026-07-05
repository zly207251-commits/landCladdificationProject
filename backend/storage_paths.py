import os


def resolve_storage_path(base_dir: str, env_var: str, default_relative_path: str) -> str:
    explicit = os.getenv(env_var)
    if explicit:
        return explicit

    storage_root = os.getenv("BACKEND_STORAGE_ROOT")
    if storage_root:
        return os.path.join(storage_root, default_relative_path)

    for candidate_root in ("/data", "/mnt/data"):
        if os.path.isdir(candidate_root) and os.access(candidate_root, os.W_OK):
            return os.path.join(candidate_root, default_relative_path)

    return os.path.join(base_dir, default_relative_path)


def resolve_storage_dir(base_dir: str, env_var: str, default_relative_dir: str) -> str:
    explicit = os.getenv(env_var)
    if explicit:
        return explicit

    storage_root = os.getenv("BACKEND_STORAGE_ROOT")
    if storage_root:
        return os.path.join(storage_root, default_relative_dir)

    for candidate_root in ("/data", "/mnt/data"):
        if os.path.isdir(candidate_root) and os.access(candidate_root, os.W_OK):
            return os.path.join(candidate_root, default_relative_dir)

    return os.path.join(base_dir, default_relative_dir)
