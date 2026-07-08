namespace Stryde.Core.Common;

public static class Validators
{
    public static Error? ValidateTitle(string? title, string fieldName = "Title")
    {
        if (string.IsNullOrWhiteSpace(title))
            return new Error(ErrorType.Validation, $"{fieldName} is required.");
        if (title.Length > 255)
            return new Error(ErrorType.Validation, $"{fieldName} cannot exceed 255 characters.");
        return null;
    }

    public static Error? ValidateColor(string? color)
    {
        if (string.IsNullOrWhiteSpace(color))
            return new Error(ErrorType.Validation, "Color is required.");
        if (!System.Text.RegularExpressions.Regex.IsMatch(color, @"^#[0-9A-Fa-f]{6}$"))
            return new Error(ErrorType.Validation, "Color must be a 6-digit hex value (e.g. #3b82f6).");
        return null;
    }

    public static Error? ValidateTimezone(string? timezoneId)
    {
        if (string.IsNullOrWhiteSpace(timezoneId))
            return new Error(ErrorType.Validation, "Timezone is required.");
        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(timezoneId);
            return null;
        }
        catch (Exception e) when (e is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            return new Error(ErrorType.Validation, "Unknown timezone.");
        }
    }

    public static Error? ValidateDateRange(DateTimeOffset? startAt, DateTimeOffset? endAt)
    {
        if (startAt.HasValue && endAt.HasValue && endAt <= startAt)
            return new Error(ErrorType.Validation, "End time must be after start time.");
        return null;
    }
}
