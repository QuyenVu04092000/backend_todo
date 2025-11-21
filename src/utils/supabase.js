import { createClient } from "@supabase/supabase-js";

const BUCKET_NAME = "images";

let supabaseClient = null;

export const getSupabaseClient = () =>
{
    if ( supabaseClient )
    {
        return supabaseClient;
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if ( !supabaseUrl || !supabaseServiceKey )
    {
        const error = new Error(
            "Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables."
        );
        error.statusCode = 500;
        throw error;
    }

    supabaseClient = createClient( supabaseUrl, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    } );

    return supabaseClient;
};

/**
 * Upload a file buffer to Supabase Storage
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - Unique filename
 * @param {string} contentType - MIME type (e.g., "image/png")
 * @returns {Promise<{ url: string }>} Public URL of the uploaded file
 */
export const uploadToSupabase = async ( buffer, filename, contentType ) =>
{
    try
    {
        const supabase = getSupabaseClient();
        const { data, error } = await supabase.storage
            .from( BUCKET_NAME )
            .upload( filename, buffer, {
                contentType,
                upsert: false,
            } );

        if ( error )
        {
            const uploadError = new Error( `Failed to upload to Supabase: ${ error.message }` );
            uploadError.statusCode = 500;
            throw uploadError;
        }

        const { data: publicUrlData } = supabase.storage
            .from( BUCKET_NAME )
            .getPublicUrl( data.path );

        if ( !publicUrlData?.publicUrl )
        {
            const urlError = new Error( "Failed to get public URL from Supabase" );
            urlError.statusCode = 500;
            throw urlError;
        }

        return { url: publicUrlData.publicUrl };
    } catch ( error )
    {
        // Provide a clearer error message if Supabase is not configured
        if ( error.message?.includes( "Missing Supabase configuration" ) )
        {
            const configError = new Error(
                "Image uploads require Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables in your .env file."
            );
            configError.statusCode = 500;
            throw configError;
        }
        // Re-throw other errors as-is
        throw error;
    }
};

/**
 * Delete a file from Supabase Storage
 * @param {string} filePath - Path to the file in the bucket (extracted from URL or stored path)
 * @returns {Promise<void>}
 */
export const deleteFromSupabase = async ( filePath ) =>
{
    try
    {
        // Extract path from URL if full URL is provided
        let path = filePath;
        if ( filePath.startsWith( "http" ) )
        {
            const url = new URL( filePath );
            // Extract path after bucket name (e.g., /images/filename.jpg -> filename.jpg)
            const pathParts = url.pathname.split( "/" );
            const bucketIndex = pathParts.indexOf( BUCKET_NAME );
            if ( bucketIndex >= 0 && bucketIndex < pathParts.length - 1 )
            {
                path = pathParts.slice( bucketIndex + 1 ).join( "/" );
            } else
            {
                // If we can't parse, try to extract from the end
                path = pathParts[ pathParts.length - 1 ];
            }
        }

        const supabase = getSupabaseClient();
        const { error } = await supabase.storage
            .from( BUCKET_NAME )
            .remove( [ path ] );

        if ( error )
        {
            // Log but don't throw - deletion failures shouldn't break the flow
            console.error( `Failed to delete file from Supabase: ${ error.message }`, { path } );
        }
    } catch ( error )
    {
        // Silently fail if Supabase is not configured - deletion is a cleanup operation
        if ( error.message?.includes( "Missing Supabase configuration" ) )
        {
            console.warn( "Supabase not configured, skipping image deletion" );
            return;
        }
        // Re-throw other errors
        throw error;
    }
};

