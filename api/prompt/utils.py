from django.db.models import Count, Q
from .models import Conversation


def can_access_task(user, task_id):
    """自由创作只有创作者本人（和超管）能对话，其他任务对所有登录用户开放。"""
    from account.models import RoleChoices
    from task.models import Creation

    owner_id = (
        Creation.objects.filter(pk=task_id).values_list("owner_id", flat=True).first()
    )
    if owner_id is None:
        return True
    return owner_id == user.id or user.role == RoleChoices.SUPER


def get_active_conversation(user, task_id):
    """Return the conversation with the most messages for this user+task, or None."""
    return (
        Conversation.objects.filter(user=user, task_id=task_id)
        .annotate(msg_count=Count("messages"))
        .order_by("-msg_count", "-created")
        .first()
    )


def get_or_create_active_conversation(user, task_id):
    conv = get_active_conversation(user, task_id)
    if not conv:
        conv = Conversation.objects.create(user=user, task_id=task_id)
    return conv


def get_preceding_user_message(asst_msg):
    """Return the user message immediately preceding an assistant message in its conversation."""
    return (
        asst_msg.conversation.messages.filter(role="user")
        .filter(
            Q(created__lt=asst_msg.created)
            | Q(created=asst_msg.created, id__lt=asst_msg.id)
        )
        .order_by("-created", "-id")
        .first()
    )
