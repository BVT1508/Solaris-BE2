import { Hono } from "hono";
import * as authCtrl from "../controllers/authController.js";
import * as memberCtrl from "../controllers/memberController.js";
import validate from "../middleware/validateMiddleware.js";
import { versionOnlySchema } from "../validators/common.js";
import {
  memberIdParams,
  listMembersQuery,
  createMemberSchema,
  updateMemberSchema,
} from "../validators/memberValidator.js";

/**
 * Gói X1, thành viên. Gắn ở /members.
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

// Quản lý thành viên: chỉ quản trị viên.
route.use(authCtrl.restrictTo("admin"));

route.get("/", validate({ query: listMembersQuery }), memberCtrl.getMembers);
route.post(
  "/",
  validate({ body: createMemberSchema }),
  memberCtrl.createMember
);
route.get("/:id", validate({ params: memberIdParams }), memberCtrl.getMember);
route.patch(
  "/:id",
  validate({ params: memberIdParams, body: updateMemberSchema }),
  memberCtrl.updateMember
);
route.post(
  "/:id/suspend",
  validate({ params: memberIdParams, body: versionOnlySchema }),
  memberCtrl.suspendMember
);
route.post(
  "/:id/activate",
  validate({ params: memberIdParams, body: versionOnlySchema }),
  memberCtrl.activateMember
);

export default route;
