FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api-build
WORKDIR /app
COPY Stryde.slnx ./
COPY src/ ./src/
RUN dotnet publish src/Stryde.Api/Stryde.Api.csproj -c Release -o /publish

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=api-build /publish ./
COPY --from=client-build /app/client/dist ./wwwroot/
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "Stryde.Api.dll"]
