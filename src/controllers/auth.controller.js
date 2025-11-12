import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import prisma from "../prisma/client.js";

const ensureJwtSecret = () =>
{
  const secret = process.env.JWT_SECRET;
  if ( !secret )
  {
    throw new Error( "JWT_SECRET is not configured" );
  }
  return secret;
};

const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "7d";

const sanitizeUser = ( user ) => ( {
  id: user.id,
  email: user.email,
  name: user.name,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
} );

const createToken = ( user ) =>
{
  const secret = ensureJwtSecret();
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      userId: user.id,
    },
    secret,
    {
      expiresIn: jwtExpiresIn,
    },
  );
};

export const register = async ( req, res, next ) =>
{
  try
  {
    const { email, password, name } = req.body;

    if ( !email || typeof email !== "string" )
    {
      const error = new Error( "Email is required" );
      error.statusCode = 400;
      throw error;
    }

    if ( !password || typeof password !== "string" || password.length < 8 )
    {
      const error = new Error( "Password must be at least 8 characters long" );
      error.statusCode = 400;
      throw error;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique( {
      where: { email: normalizedEmail },
      select: { id: true },
    } );

    if ( existing )
    {
      const error = new Error( "Email is already registered" );
      error.statusCode = 409;
      throw error;
    }

    const passwordHash = await bcrypt.hash( password, 12 );

    const user = await prisma.user.create( {
      data: {
        email: normalizedEmail,
        passwordHash,
        name: typeof name === "string" && name.trim() ? name.trim() : null,
      },
    } );

    const token = createToken( user );

    res.status( 201 ).json( {
      success: true,
      data: {
        token,
        user: sanitizeUser( user ),
      },
      message: "Registration successful",
    } );
  } catch ( error )
  {
    next( error );
  }
};

export const login = async ( req, res, next ) =>
{
  try
  {
    const { email, password } = req.body;

    if ( !email || typeof email !== "string" || !password )
    {
      const error = new Error( "Email and password are required" );
      error.statusCode = 400;
      throw error;
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await prisma.user.findUnique( {
      where: { email: normalizedEmail },
    } );

    if ( !user )
    {
      const error = new Error( "Invalid email or password" );
      error.statusCode = 401;
      throw error;
    }

    const isValid = await bcrypt.compare( password, user.passwordHash );
    if ( !isValid )
    {
      const error = new Error( "Invalid email or password" );
      error.statusCode = 401;
      throw error;
    }

    const token = createToken( user );

    res.status( 200 ).json( {
      success: true,
      data: {
        token,
        user: sanitizeUser( user ),
      },
      message: "Login successful",
    } );
  } catch ( error )
  {
    next( error );
  }
};

export const getProfile = async ( req, res, next ) =>
{
  try
  {
    const userId = req.user.id;
    const user = await prisma.user.findUnique( { where: { id: userId } } );

    if ( !user )
    {
      res.status( 404 ).json( { success: false, data: null, message: "User not found" } );
      return;
    }

    res.status( 200 ).json( {
      success: true,
      data: sanitizeUser( user ),
      message: "Profile fetched successfully",
    } );
  } catch ( error )
  {
    next( error );
  }
};

