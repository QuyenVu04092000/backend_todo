import jwt from "jsonwebtoken";

const ensureJwtSecret = () =>
{
  const secret = process.env.JWT_SECRET;
  if ( !secret )
  {
    throw new Error( "JWT_SECRET is not configured" );
  }
  return secret;
};

const extractToken = ( req ) =>
{
  const authHeader = req.headers.authorization;
  if ( authHeader && authHeader.startsWith( "Bearer " ) )
  {
    return authHeader.slice( 7 ).trim();
  }

  if ( req.cookies?.token )
  {
    return req.cookies.token;
  }

  return null;
};

const authenticate = ( req, res, next ) =>
{
  try
  {
    const token = extractToken( req );
    if ( !token )
    {
      res.status( 401 ).json( { success: false, data: null, message: "Authentication required" } );
      return;
    }

    const secret = ensureJwtSecret();
    const payload = jwt.verify( token, secret );
    const rawId = typeof payload.userId !== "undefined"
      ? payload.userId
      : payload.sub;
    const parsedId = typeof rawId === "string" ? Number.parseInt( rawId, 10 ) : rawId;

    if ( Number.isNaN( parsedId ) || !parsedId )
    {
      res.status( 401 ).json( { success: false, data: null, message: "Invalid authentication token" } );
      return;
    }

    req.user = {
      id: parsedId,
      email: payload.email,
      token,
    };

    next();
  } catch ( error )
  {
    res.status( 401 ).json( {
      success: false,
      data: null,
      message: "Invalid or expired authentication token",
    } );
  }
};

export default authenticate;

