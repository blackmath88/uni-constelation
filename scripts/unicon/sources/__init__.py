"""Source adapters.

Each adapter owns one public source and returns plain dicts; nothing downstream
knows about HTTP. A future authorised UNIverse export/API would be a new
adapter here that emits the same raw record shape (see docs/DATA_METHOD.md).
"""
