import multer from "multer";

const fileFilter = ( _req, file, cb ) =>
{
  if ( !file.mimetype.startsWith( "image/" ) )
  {
    const error = new Error( "Only image files are allowed" );
    error.statusCode = 400;
    return cb( error );
  }
  cb( null, true );
};

const storage = multer.memoryStorage();

const upload = multer( {
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
} );

export default upload;
