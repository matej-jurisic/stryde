using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Stryde.Api.Auth;
using Stryde.Api.Endpoints;
using Stryde.Core;
using Stryde.Core.Auth;
using System.IdentityModel.Tokens.Jwt;
using System.Text;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddStrydeCore(builder.Configuration);

builder.Services.ConfigureHttpJsonOptions(o =>
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.Configure<RefreshCookieOptions>(builder.Configuration.GetSection("Auth:RefreshCookie"));
builder.Services.AddScoped<RefreshCookieManager>();

// Keep JWT claim types verbatim ("sub") instead of legacy SOAP URI mappings.
JwtSecurityTokenHandler.DefaultMapInboundClaims = false;
var jwt = builder.Configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>() ?? new JwtOptions();

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.MapInboundClaims = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwt.Secret)),
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
            NameClaimType = "username",
        };
    });

builder.Services.AddAuthorization();

var corsOrigins = (builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [])
    .Where(o => !string.IsNullOrWhiteSpace(o)).ToArray();
if (corsOrigins.Length > 0)
{
    builder.Services.AddCors(options =>
        options.AddDefaultPolicy(policy =>
            policy.WithOrigins(corsOrigins)
                  .AllowAnyHeader()
                  .AllowAnyMethod()
                  .AllowCredentials()));
}

var app = builder.Build();

if (builder.Configuration.GetValue<bool>("Database:MigrateOnStartup"))
    app.Services.MigrateDatabase();

app.UseDefaultFiles();
app.UseStaticFiles();
if (corsOrigins.Length > 0)
    app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();
app.MapAuthEndpoints();
app.MapGoalEndpoints();
app.MapActivityEndpoints();
app.MapOccurrenceEndpoints();
app.MapCheckpointEndpoints();
app.MapSettingsEndpoints();
app.MapRecommendationEndpoints();
app.MapCategoryEndpoints();

app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
