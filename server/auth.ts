import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPg from "connect-pg-simple";
import type { Express, RequestHandler } from "express";
import { storage } from "./storage";
import type { User } from "@shared/schema";

const pgStore = connectPg(session);

export function setupAuth(app: Express) {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const isProduction = process.env.NODE_ENV === "production";

  if (isProduction) {
    app.set("trust proxy", 1);
  }

  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  app.use(
    session({
      secret: process.env.SESSION_SECRET || "mbt-service-dev-secret",
      store: sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: isProduction && process.env.COOKIE_SECURE !== "false",
        sameSite: "lax",
        maxAge: sessionTtl,
      },
    })
  );

  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(
      { usernameField: "email" },
      async (email, password, done) => {
        try {
          const user = await storage.getUserByEmail(email);
          if (!user) {
            return done(null, false, { message: "Неверный email или пароль" });
          }
          if (!user.passwordHash) {
            return done(null, false, { message: "Неверный метод аутентификации" });
          }
          const isValidPassword = await bcrypt.compare(password, user.passwordHash);
          if (!isValidPassword) {
            return done(null, false, { message: "Неверный email или пароль" });
          }
          if (!user.isActive) {
            return done(null, false, { message: "Учётная запись деактивирована. Обратитесь к администратору." });
          }
          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      done(error);
    }
  });
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const user = req.user as User;
  if (!user.isActive) {
    req.logout((err) => {
      if (err) console.error("Error logging out inactive user:", err);
    });
    return res.status(401).json({ message: "Учётная запись деактивирована" });
  }
  next();
};

// In standalone MBT service, all authenticated users have mbt module access
export const requireModuleAccess = (_moduleId: string): RequestHandler => {
  return async (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  };
};

declare global {
  namespace Express {
    interface User {
      id: string;
      email: string | null;
      username: string;
      passwordHash: string;
      roleId: string;
      createdAt: Date;
      lastLoginAt: Date | null;
      isActive: boolean;
      legalEntityId: string | null;
      metadata: Record<string, any> | null;
    }
  }
}
