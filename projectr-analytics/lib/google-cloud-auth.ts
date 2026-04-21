type GoogleAuthModule = typeof import('google-auth-library')

const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

let cachedModulePromise: Promise<GoogleAuthModule> | null = null

async function loadGoogleAuthModule(): Promise<GoogleAuthModule> {
  if (!cachedModulePromise) {
    cachedModulePromise = import('google-auth-library')
  }

  return cachedModulePromise
}

export async function getGoogleCloudAccessToken(scopes: string[] = [CLOUD_PLATFORM_SCOPE]): Promise<string> {
  const { GoogleAuth } = await loadGoogleAuthModule()
  const options: any = { scopes }
  if (process.env.GOOGLE_CREDENTIALS) {
    try {
      options.credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS)
    } catch {}
  }
  const auth = new GoogleAuth(options)
  const client = await auth.getClient()
  const tokenResponse = await client.getAccessToken()
  const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token

  if (!token) {
    throw new Error('Unable to acquire a Google Cloud access token.')
  }

  return token
}
