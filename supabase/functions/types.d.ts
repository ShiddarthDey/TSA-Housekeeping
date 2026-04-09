declare const Deno: {
  env: {
    get: (key: string) => string | undefined
  }
  serve: (handler: (req: Request) => Response | Promise<Response>) => void
}

declare module 'npm:@supabase/supabase-js@2' {
  type SbError = { message?: string } | null
  type SbUser = { id: string } | null

  type SbResult<T> = Promise<{ data: T; error: SbError }>

  type SbQuery<T> = {
    select: (...args: unknown[]) => SbQuery<T>
    eq: (...args: unknown[]) => SbQuery<T>
    maybeSingle: () => SbResult<T | null>
    insert: (values: unknown) => SbResult<null>
  }

  type SbClient = {
    auth: {
      getUser: () => SbResult<{ user: SbUser }>
      admin: {
        createUser: (params: unknown) => SbResult<{ user: SbUser }>
        deleteUser: (id: string) => SbResult<null>
      }
    }
    from: <T = unknown>(table: string) => SbQuery<T>
  }

  export const createClient: (...args: unknown[]) => SbClient
}
