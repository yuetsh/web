from typing import List
from ninja import Router
from ninja.errors import HttpError
from django.shortcuts import get_object_or_404
from django.contrib.auth.decorators import login_required

from account.models import RoleChoices
from .models import Creation
from .schemas import CreationCodeIn, CreationIn, CreationOut, CreationSlim

router = Router()


def _clean_title(title: str) -> str:
    title = (title or "").strip()
    if not title:
        raise HttpError(400, "主题名称不能为空")
    return title[:100]


def _get_owned(request, display: int) -> Creation:
    creation = get_object_or_404(Creation, display=display)
    if creation.owner_id != request.user.id and request.user.role != RoleChoices.SUPER:
        raise HttpError(403, "只能操作自己的创作")
    return creation


@router.get("/mine", response=List[CreationSlim])
@login_required
def list_mine(request):
    """
    当前用户自己创建的所有主题
    """
    return Creation.objects.filter(owner=request.user)


@router.post("/", response=CreationOut)
@login_required
def create(request, payload: CreationIn):
    """
    新建一个主题，序号由后端自动分配
    """
    return Creation.objects.create(
        owner=request.user,
        title=_clean_title(payload.title),
        content=payload.content,
    )


@router.get("/{display}", response=CreationOut)
@login_required
def get(request, display: int):
    return _get_owned(request, display)


@router.put("/{display}", response=CreationOut)
@login_required
def update(request, display: int, payload: CreationIn):
    """
    修改主题名称和主题描述
    """
    creation = _get_owned(request, display)
    creation.title = _clean_title(payload.title)
    creation.content = payload.content
    creation.save(update_fields=["title", "content", "modified"])
    return creation


@router.put("/{display}/code", response=CreationOut)
@login_required
def update_code(request, display: int, payload: CreationCodeIn):
    """
    保存当前作品代码
    """
    creation = _get_owned(request, display)
    creation.html = payload.html
    creation.css = payload.css
    creation.js = payload.js
    creation.save(update_fields=["html", "css", "js", "modified"])
    return creation


@router.delete("/{display}")
@login_required
def remove(request, display: int):
    creation = _get_owned(request, display)
    creation.delete()
    return {"message": "删除成功"}
