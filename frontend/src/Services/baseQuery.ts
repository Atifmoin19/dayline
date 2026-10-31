import type { BaseQueryFn } from "@reduxjs/toolkit/query";
import type { SerializedError } from "@reduxjs/toolkit";
import axios, { type AxiosError, type AxiosRequestConfig } from "axios";
import { BASE_URL } from "../Utils/constants";

import { resetStore } from "app/slices/scheduler.slice";
import type { RootState } from "app/store";

/** Shape of the raw error payload our axios interceptor surfaces as `ApiError.data` — usually
 * the backend response body. Nested `data.details` covers the `{ success: false, data: {
 * details } }` backend envelope; the flatter `message`/`error_text` cover simpler error bodies. */
export interface ApiErrorData {
  message?: string;
  error_text?: string;
  details?: string;
  data?: { details?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/** Error shape returned by `axiosBaseQuery` for every failed request — what RTK Query mutation
 * `.unwrap()` calls reject with (or return as `{ error }` from the trigger promise). */
export interface ApiError {
  status?: number | string;
  message: string;
  data?: ApiErrorData | string;
}

/** Best-effort human-readable message out of an RTK Query mutation error, covering both our
 * axios-backed `ApiError` shape and RTK's fallback `SerializedError` (used if something throws
 * before a request even reaches the base query). */
export const getApiErrorMessage = (
  error: unknown,
  fallback?: string,
): string | undefined => {
  if (!error || typeof error !== "object") return fallback;
  const err = error as Partial<ApiError> & Partial<SerializedError>;
  const data = typeof err.data === "object" ? err.data : undefined;
  return data?.data?.details || data?.message || err.message || fallback;
};

export const getDefaultHeaders = ({
  token,
}: {
  token: string;
  baseUrl?: string;
}): Record<string, string> => {
  const tempHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Source: "Web",
    Lang: "EN",
  };
  if (token) {
    tempHeaders["Authorization"] = `Token ${token}`;
    return tempHeaders;
  }
  return tempHeaders;
};

export const getFileHeaders = (token: string, onlyToken?: boolean) => {
  const tempHeaders = {
    "Content-Type": "multipart/form-data",
    Source: "Web",
    Lang: "EN",
  };
  if (token) {
    return {
      ...tempHeaders,
      Authorization: onlyToken ? token : `Token ${token}`,
    };
  }
  return tempHeaders;
};

export const axiosBaseQuery =
  ({
    baseUrl,
  }: {
    baseUrl: string;
  }): BaseQueryFn<
    {
      url: string;
      method: AxiosRequestConfig["method"];
      body?: AxiosRequestConfig["data"];
      params?: AxiosRequestConfig["params"];
      headers?: AxiosRequestConfig["headers"];
      responseType?: AxiosRequestConfig["responseType"];
      rawResponse?: boolean;
    },
    unknown,
    ApiError
  > =>

    async ({ url, method, body, params = {}, headers, responseType }, { getState, dispatch }) => {

      const state = getState() as RootState;
      const token = state.scheduler?.token;

      let requestHeaders: AxiosRequestConfig["headers"] | Record<string, string> = headers;
      if (!requestHeaders) {
        const defaultHeaders = getDefaultHeaders({
          baseUrl,
          token: token ?? "",
        });
        // If body is FormData, let browser/axios set Content-Type to multipart/form-data with boundary
        if (body instanceof FormData) {
          delete defaultHeaders["Content-Type"];
        }
        requestHeaders = defaultHeaders;
      }

      try {
        const result = await axios({
          url: baseUrl + url,
          method,
          data: body,
          params: params,
          headers: requestHeaders,
          responseType,
        });
        return { data: result?.data?.data };
      } catch (error) {

        if (axios.isAxiosError(error)) {
          const err = error as AxiosError<ApiErrorData>;
          if (err.response?.status === 401) {
            dispatch(resetStore())
          }

          return {
            error: {
              status: err.response?.status,
              message: err.message,
              data: err.response?.data || err.message,
            },
          };
        } else {
          // Defensive fallback for a rejection that never reached axios (e.g. a thrown value
          // from code above) — shape is not guaranteed, so this narrow interface (rather than
          // `any`) just describes the fields we optionally read off it.
          const err = error as { status?: number; data?: ApiErrorData; message?: string };
          return {
            error: {
              status: err.status,
              data: err.data?.error_text
                ? err.data
                : {
                  error_text: err?.message
                    ? err.message
                    : "Something went wrong!",
                },
              message: err.message ?? "Something went wrong!",
            },
          };
        }
      }
    };

const baseUrlQuery = axiosBaseQuery({
  baseUrl: BASE_URL,
});

export { baseUrlQuery };
