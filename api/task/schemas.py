from datetime import datetime
from typing import Optional
from ninja import Schema, ModelSchema
from .models import Tutorial, Challenge


class TutorialSlim(Schema):
    display: int
    title: str
    is_public: bool


class TutorialAll(ModelSchema):
    class Meta:
        model = Tutorial
        fields = "__all__"


class TutorialIn(Schema):
    display: int
    title: str
    content: str
    is_public: bool = False
    example_html: Optional[str] = None
    example_css: Optional[str] = None
    example_js: Optional[str] = None


class ChallengeSlim(Schema):
    display: int
    title: str
    score: int
    pass_score: Optional[float] = None
    is_public: bool
    author_name: Optional[str] = None


class ChallengeDisplay(ChallengeSlim):
    submitted: bool


class ChallengeAll(ModelSchema):
    author_name: Optional[str] = None

    class Meta:
        model = Challenge
        fields = "__all__"


class ChallengeIn(Schema):
    display: int
    title: str
    content: str
    score: int = 0
    is_public: bool = False
    example_html: Optional[str] = None
    example_css: Optional[str] = None
    example_js: Optional[str] = None


class CreationSlim(Schema):
    display: int
    title: str
    content: str
    created: datetime
    modified: datetime
    has_code: bool

    @staticmethod
    def resolve_has_code(obj):
        return bool(obj.html or obj.css or obj.js)


class CreationOut(Schema):
    task_id: int
    display: int
    title: str
    content: str
    html: str
    css: str
    js: str
    owner_name: str
    created: datetime
    modified: datetime

    @staticmethod
    def resolve_task_id(obj):
        return obj.pk


class CreationIn(Schema):
    title: str
    content: str = ""


class CreationCodeIn(Schema):
    html: str = ""
    css: str = ""
    js: str = ""
