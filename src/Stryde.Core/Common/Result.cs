namespace Stryde.Core.Common;

/// <summary>
/// <see cref="Unavailable"/> is for a dependency outside the app that did not answer - today only
/// the user's own model server. It is not a bug and not the user's mistake, so it is neither a 500
/// nor a 400: the caller is meant to shrug and carry on without the feature.
/// </summary>
public enum ErrorType { Validation, NotFound, Conflict, Unauthorized, Forbidden, Unavailable }

public sealed record Error(ErrorType Type, string Message);

public sealed class Result
{
    public bool IsSuccess { get; }
    public Error? Error { get; }

    private Result(bool isSuccess, Error? error)
    {
        IsSuccess = isSuccess;
        Error = error;
    }

    public static Result Success() => new(true, null);
    public static Result Fail(Error error) => new(false, error);
}

public sealed class Result<T>
{
    public bool IsSuccess { get; }
    public T? Value { get; }
    public Error? Error { get; }

    private Result(bool isSuccess, T? value, Error? error)
    {
        IsSuccess = isSuccess;
        Value = value;
        Error = error;
    }

    public static Result<T> Success(T value) => new(true, value, null);
    public static Result<T> Fail(Error error) => new(false, default, error);
}
