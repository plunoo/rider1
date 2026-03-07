import sys

try:
    from py_vapid import Vapid
except Exception:
    print("py_vapid is required to generate VAPID keys. Install backend dependencies first.")
    sys.exit(1)


def main() -> None:
    vapid = Vapid()
    vapid.generate_keys()
    print("VAPID_PUBLIC_KEY=" + vapid.public_key)
    print("VAPID_PRIVATE_KEY=" + vapid.private_key)
    print("VAPID_SUBJECT=mailto:admin@example.com")


if __name__ == "__main__":
    main()
