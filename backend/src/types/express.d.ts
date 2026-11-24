// The authenticated user attached to each /api request. Shaped to merge with
// passport's own Express.User / req.user declarations when M8 adds them.
declare global {
  namespace Express {
    interface User {
      id: string;
      email: string;
      name: string;
    }
    interface Request {
      user?: User;
    }
  }
}

export {};
