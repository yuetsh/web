from django.test import TestCase
from django.contrib.auth import get_user_model

from prompt.utils import can_access_task
from task.models import Creation

User = get_user_model()


def _make_user(username="student1"):
    return User.objects.create_user(username=username, password="pw")


class CreationApiTest(TestCase):
    def setUp(self):
        self.user = _make_user("student1")
        self.other = _make_user("student2")
        self.client.force_login(self.user)

    def _create(self, title="我的计时器", content="做一个倒计时"):
        return self.client.post(
            "/api/creation/",
            data={"title": title, "content": content},
            content_type="application/json",
        )

    def test_create_assigns_display(self):
        """新建主题时后端自动分配递增的序号"""
        first = self._create().json()
        second = self._create("第二个主题").json()
        self.assertEqual(second["display"], first["display"] + 1)
        self.assertEqual(first["owner_name"], "student1")
        self.assertEqual(first["task_id"], Creation.objects.get(display=first["display"]).pk)

    def test_create_rejects_empty_title(self):
        resp = self._create(title="   ")
        self.assertEqual(resp.status_code, 400)

    def test_list_mine_only_returns_own(self):
        self._create()
        self.client.force_login(self.other)
        self._create("别人的主题")
        resp = self.client.get("/api/creation/mine")
        self.assertEqual(resp.status_code, 200)
        titles = [item["title"] for item in resp.json()]
        self.assertEqual(titles, ["别人的主题"])

    def test_update_and_save_code(self):
        display = self._create().json()["display"]
        resp = self.client.put(
            f"/api/creation/{display}",
            data={"title": "新名字", "content": "新的描述"},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["title"], "新名字")

        resp = self.client.put(
            f"/api/creation/{display}/code",
            data={"html": "<p>hi</p>", "css": "p{color:red}", "js": ""},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 200)
        creation = Creation.objects.get(display=display)
        self.assertEqual(creation.html, "<p>hi</p>")

        resp = self.client.get("/api/creation/mine")
        self.assertTrue(resp.json()[0]["has_code"])

    def test_other_user_cannot_read_or_change(self):
        display = self._create().json()["display"]
        self.client.force_login(self.other)
        self.assertEqual(self.client.get(f"/api/creation/{display}").status_code, 403)
        self.assertEqual(self.client.delete(f"/api/creation/{display}").status_code, 403)

    def test_delete(self):
        display = self._create().json()["display"]
        self.assertEqual(self.client.delete(f"/api/creation/{display}").status_code, 200)
        self.assertFalse(Creation.objects.filter(display=display).exists())

    def test_submission_rejected_for_creation(self):
        """自由创作不进入提交/评分体系"""
        task_id = self._create().json()["task_id"]
        resp = self.client.post(
            "/api/submission/",
            data={"task_id": task_id, "html": "<p>hi</p>", "css": "", "js": ""},
            content_type="application/json",
        )
        self.assertEqual(resp.status_code, 400)

    def test_can_access_task_limits_chat_to_owner(self):
        creation = Creation.objects.create(owner=self.user, title="t", content="")
        self.assertTrue(can_access_task(self.user, creation.pk))
        self.assertFalse(can_access_task(self.other, creation.pk))
