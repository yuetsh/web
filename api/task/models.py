from django.db import models
from django.conf import settings
from django_extensions.db.models import TimeStampedModel


class TaskTypeChoices(models.TextChoices):
    CHALLENGE = "challenge", "挑战"
    TUTORIAL = "tutorial", "教程"
    CREATION = "creation", "创作"


class Task(TimeStampedModel):
    display = models.IntegerField(db_index=True, verbose_name="序号")
    title = models.CharField(max_length=100, verbose_name="标题")
    content = models.TextField(verbose_name="内容")
    task_type = models.CharField(
        max_length=20,
        choices=TaskTypeChoices.choices,
        editable=False,
        verbose_name="类型",
    )
    is_public = models.BooleanField(default=False, verbose_name="是否公开")
    example_html = models.TextField(null=True, blank=True, verbose_name="示例HTML")
    example_css = models.TextField(null=True, blank=True, verbose_name="示例CSS")
    example_js = models.TextField(null=True, blank=True, verbose_name="示例JS")

    class Meta:
        unique_together = ("display", "task_type")

    def save(self, *args, **kwargs):
        if not self.task_type:
            self.task_type = self.__class__.__name__.lower()
        super().save(*args, **kwargs)


class Tutorial(Task):
    def __str__(self):
        return self.title

    class Meta:
        ordering = ("display",)
        verbose_name = "教程"
        verbose_name_plural = verbose_name


class Challenge(Task):
    score = models.IntegerField(default=0)
    pass_score = models.FloatField(null=True, blank=True, verbose_name="通过分数线")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="authored_challenges",
        verbose_name="出题人",
    )

    @property
    def author_name(self):
        return self.author.username if self.author_id else ""

    def __str__(self):
        return self.title

    class Meta:
        ordering = ("display",)
        verbose_name = "挑战"
        verbose_name_plural = verbose_name


class Creation(Task):
    """
    用户自己创建的主题：标题和内容都由用户自己写，只有创作者本人能看到和修改
    """

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="creations",
        verbose_name="创作者",
    )
    html = models.TextField(blank=True, default="", verbose_name="HTML代码")
    css = models.TextField(blank=True, default="", verbose_name="CSS代码")
    js = models.TextField(blank=True, default="", verbose_name="JS代码")

    @property
    def owner_name(self):
        return self.owner.username if self.owner_id else ""

    def save(self, *args, **kwargs):
        if not self.display:
            last = (
                Creation.objects.order_by("-display")
                .values_list("display", flat=True)
                .first()
            )
            self.display = (last or 0) + 1
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title

    class Meta:
        ordering = ("-created",)
        verbose_name = "创作"
        verbose_name_plural = verbose_name


def task_asset_upload_to(instance, filename):
    return f"tasks/{instance.task.task_type}/{instance.task.display}/{instance.name}"


class TaskAsset(models.Model):
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="assets")
    name = models.CharField(max_length=100, verbose_name="文件名")
    file = models.FileField(upload_to=task_asset_upload_to, verbose_name="文件")

    class Meta:
        unique_together = ("task", "name")
        verbose_name = "任务素材"
        verbose_name_plural = verbose_name

    def __str__(self):
        return f"{self.task} / {self.name}"
