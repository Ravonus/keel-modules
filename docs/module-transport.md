New catalog runtime packages use Base90 (base90-v1) and Brotli when smaller.
Runtime records expose encoding, compression, encryption:none, and stored/decoded
commitments; output digests still cover the unchanged executable bytes. JSON is
script-safe. Existing on-chain deployments keep their committed transport.

This catalog refresh must follow deployment of Studio's Base90-aware parser and
verified module reader. Current deployed Studio readers accept only Base64, so
promote this branch after that consumer release has been checked.
