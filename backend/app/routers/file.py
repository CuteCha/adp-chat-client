"""文件：上传、实时文档解析、工作空间下载/列目录。

- upload：请求体是文件原始字节 → DescribeStorageCredential 预签名 → PUT 到 COS
- parse：代理 LKE 的 docParse SSE，用于拿 doc_id（standard 模式上传后必须走这步）
- download / list_dir：工作空间（沙箱）文件系统，后端代理以避免跨域
"""

import logging
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse

from app.deps import UserId
from app.registry import get_app
from app.tcadp import UpstreamError

router = APIRouter(prefix='/file', tags=['file'])

SSE_HEADERS = {'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no'}


@router.post('/upload')
async def upload_file(
    request: Request,
    user_id: UserId,
    application_id: str = Query(..., alias='ApplicationId'),
    mime_type: str = Query('image/jpeg', alias='Type'),
    mode: str = Query('standard', alias='Mode'),
):
    """请求体为文件原始字节；返回 {Url, CosUrl, CosBucket}。"""
    app = get_app(application_id)
    file_data = await request.body()
    if not file_data:
        raise HTTPException(status_code=400, detail='文件内容为空')

    logging.info(
        '[file.upload] ApplicationId=%s Type=%s Mode=%s size=%s',
        application_id, mime_type, mode, len(file_data),
    )
    try:
        result = await app.upload(file_data, mime_type, mode)
    except UpstreamError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
    return result


@router.post('/parse')
async def parse_file(request: Request, user_id: UserId):
    """代理 docParse SSE 流，前端据此拿到 doc_id。"""
    body = await request.json()
    application_id = body.get('ApplicationId')
    if not application_id:
        raise HTTPException(status_code=400, detail='ApplicationId is required')
    app = get_app(application_id)

    async def _stream():
        async for chunk in app.parse_document(
            file_name=body.get('FileName', ''),
            file_type=body.get('FileType', ''),
            cos_bucket=body.get('CosBucket', ''),
            cos_url=body.get('CosUrl', ''),
            e_tag=body.get('ETag', ''),
            cos_hash=body.get('CosHash', ''),
            size=body.get('Size', '0'),
            conversation_id=body.get('ConversationId', ''),
        ):
            yield chunk

    return StreamingResponse(
        _stream(), media_type='text/event-stream; charset=utf-8', headers=SSE_HEADERS
    )


@router.get('/download')
async def download_file(
    user_id: UserId,
    application_id: str = Query(..., alias='ApplicationId'),
    app_id: str = Query('', alias='AppId'),
    workspace_id: str = Query('', alias='WorkspaceId'),
    path: str = Query(..., alias='Path'),
):
    """从工作空间下载文件原始内容（前端用同域地址避免跨域）。"""
    app = get_app(application_id)
    try:
        content, content_type, file_name = await app.download_file_content(
            app_id or app.config.get('AppId', ''), workspace_id, path
        )
    except UpstreamError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    return Response(
        content=content,
        media_type=content_type,
        headers={
            'Content-Disposition': f"attachment; filename*=UTF-8''{quote(file_name, safe='')}",
        },
    )


@router.get('/list_dir')
async def list_dir(
    user_id: UserId,
    application_id: str = Query(..., alias='ApplicationId'),
    app_id: str = Query('', alias='AppId'),
    workspace_id: str = Query('', alias='WorkspaceId'),
    path: str = Query('/workdir', alias='Path'),
    depth: int = Query(1, alias='Depth'),
):
    app = get_app(application_id)
    try:
        return await app.list_dir(
            app_id or app.config.get('AppId', ''), path, depth, workspace_id
        )
    except UpstreamError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e
