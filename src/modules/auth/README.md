# auth

Owns Argon2id admin passwords, opaque database sessions, token hashing and the interactive administrator-creation command. `argon2idOptions` is exported as the shared hashing contract so customer credentials use identical parameters without sharing storage, cookies or sessions. Customer identity and authentication live in `src/modules/customer`.
