from typing import Any

from fastapi import status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse


def response(status_code: int = status.HTTP_400_BAD_REQUEST, message: str | None = None, data: Any = None):
    if data and isinstance(data, dict) and data.get("error_text"):
        message = data.get("error_text")

    body = {
        'status': status_code,
        'message': message,
        'data': data
    }
    # jsonable_encoder converts datetime (and other non-JSON types) to ISO strings so
    # DateTime columns serialize cleanly through JSONResponse.
    return JSONResponse(content=jsonable_encoder(body), status_code=status_code, headers={'Cache-Control': 'no-cache'})